#requires -Version 7.2
param(
  [string]$SnapshotPath,
  [string]$OperationId,
  [string]$RecipientChatId,
  [string]$ExpectedBotId,
  [string]$ExpectedBotUsername,
  [string]$ExpectedWindowsSid,
  [string]$ExpectedReportSha256,
  [string]$ReceiptDirectory,
  [string]$RecipientType='private',
  [string[]]$GroupMemberIds,
  [string]$ExpectedAudienceSha256,
  [switch]$Prepare,
  [switch]$Send
)

$ErrorActionPreference = 'Stop'

function Get-DeliveryHash([string]$Text) {
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant()
}

function Get-DeliveryUtcNow { return [DateTimeOffset]::UtcNow }

function Get-CurrentGroupAudience([string]$ChatId, [string]$BotId, [string[]]$MemberIds) {
  if ($ChatId -cnotmatch '^-[1-9][0-9]{0,15}$' -or $BotId -cnotmatch '^[1-9][0-9]{0,15}$' -or $MemberIds.Count -ne 2) {
    throw 'Exact three-member group binding required'
  }
  $members=@($MemberIds | Sort-Object -CaseSensitive)
  if (@($members | Select-Object -Unique).Count -ne 2) { throw 'Distinct human member IDs required' }
  foreach ($id in $members) {
    if ($id -cnotmatch '^[1-9][0-9]{0,15}$' -or $id -ceq $BotId) { throw 'Exact human member IDs required' }
  }
  $ids=$members -join "`n"
  return [pscustomobject]@{ MemberIds=$members; MemberCount=3; Sha256=(Get-DeliveryHash "schoology-current-group-audience/v1`n$ChatId`n$BotId`n$ids") }
}

function Test-CurrentGroupMemberCount($Response, [int]$Expected) {
  return ($Response.Success -and ($Response.Result -is [int] -or $Response.Result -is [long]) -and $Response.Result -eq $Expected)
}

function Test-CurrentGroupMember($Response, [string]$Id, [bool]$Bot, [string]$Username) {
  if (-not $Response.Success -or [string]$Response.Result.user.id -cne $Id -or
    $Response.Result.user.is_bot -isnot [bool] -or $Response.Result.user.is_bot -ne $Bot) { return $false }
  $member=$Response.Result
  $present=($member.status -cin @('creator','administrator','member') -or ($member.status -ceq 'restricted' -and $member.is_member -is [bool] -and $member.is_member))
  if (-not $present) { return $false }
  if ($Bot -and ($member.user.username -cne $Username -or
    ($member.status -ceq 'restricted' -and ($member.can_send_messages -isnot [bool] -or -not $member.can_send_messages)))) { return $false }
  return $true
}

function Get-CurrentDeliveryReport([string]$RepoRoot, [string]$InputPath) {
  # Read only the supplied snapshot. Bound input before invoking the existing
  # pure formatter; never load .env, old state, SQLite or a service entrypoint.
  $stream = [IO.File]::OpenRead($InputPath)
  $memory = [IO.MemoryStream]::new()
  try {
    $buffer = [byte[]]::new(8192)
    while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if ($memory.Length + $count -gt 1048576) { throw 'Snapshot input limit exceeded' }
      $memory.Write($buffer, 0, $count)
    }
    $bytes = $memory.ToArray()
  } finally { $stream.Dispose(); $memory.Dispose() }
  $utf8 = [Text.UTF8Encoding]::new($false, $true)
  # PowerShell's JSON conversion can turn ISO strings into DateTime values.
  # Keep the original offset: reparsing a coerced DateTime string loses it.
  $snapshot = [Text.Json.JsonDocument]::Parse($utf8.GetString($bytes))
  $observedAt = $snapshot.RootElement.GetProperty('observedAt').GetString()
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Get-Command node -CommandType Application | Select-Object -First 1).Source
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardInputEncoding = $utf8
  $start.StandardOutputEncoding = $utf8
  $start.StandardErrorEncoding = $utf8
  $start.ArgumentList.Add((Join-Path $RepoRoot 'src/current_summary_cli.js'))
  $start.ArgumentList.Add('--stdin')
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  try {
    [void]$process.Start()
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) {
      $process.Kill($true)
      $process.WaitForExit()
      throw 'Current formatter timed out'
    }
    if ($process.ExitCode -ne 0) { throw 'Current snapshot refused' }
    $text = $output.GetAwaiter().GetResult().TrimEnd("`r", "`n")
    [void]$errors.GetAwaiter().GetResult()
    if (-not $text -or $text.Length -gt 4096) { throw 'Report must fit one Telegram message' }
    return [pscustomobject]@{ Text=$text; Sha256=(Get-DeliveryHash $text); Characters=$text.Length; ObservedAt=$observedAt }
  } finally { $process.Dispose(); $snapshot.Dispose(); $bytes=$null; $snapshot=$null }
}

function Get-CurrentBotCredential([string]$RepoRoot, [string]$WindowsSid) {
  if (-not $IsWindows -or [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $WindowsSid) {
    throw 'Existing Windows principal required'
  }
  # Define only the previously qualified native library. Do not execute the
  # manager's import/export/verify/template/sanitize lifecycle actions.
  $parseTokens=$null; $parseErrors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $RepoRoot 'scripts/manage_schoology_secrets.ps1'), [ref]$parseTokens, [ref]$parseErrors)
  $definitions=@($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Add-CredentialManagerType' }, $true))
  if ($parseErrors.Count -ne 0 -or $definitions.Count -ne 1) { throw 'Native library unavailable' }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
  Add-CredentialManagerType
  return [SchoologyBot.CredentialManager]::Read('schoology-bot/prod/TELEGRAM_BOT_TOKEN')
}

function ConvertFrom-CurrentTelegramResponse([int]$Status, [string]$Json) {
  $body=$Json | ConvertFrom-Json -Depth 30
  $retry=0
  if (($body.parameters.retry_after -is [long] -or $body.parameters.retry_after -is [int]) -and $body.parameters.retry_after -gt 0) {
    $retry=$body.parameters.retry_after
  }
  # Preserve the actual provider delay; never shorten it to a local ceiling.
  # Error descriptions may contain request data and are deliberately discarded.
  return [pscustomobject]@{ Status=$Status; Success=($Status -ge 200 -and $Status -lt 300 -and $body.ok -is [bool] -and $body.ok); Result=$body.result; RetryAfterSeconds=$retry }
}

function New-CurrentTelegramTransport {
  $handler=[Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect=$false
  $client=[Net.Http.HttpClient]::new($handler)
  $client.Timeout=[TimeSpan]::FromSeconds(12)
  $client.MaxResponseContentBufferSize=65536
  return [pscustomobject]@{ Client=$client; Handler=$handler }
}

function Close-CurrentTelegramTransport($Transport) {
  # Cleanup must not replace the delivery result with a secret-bearing error.
  try { $Transport.Client.Dispose() } catch {}
  try { $Transport.Handler.Dispose() } catch {}
}

function Invoke-CurrentTelegramRequest([string]$Token, [string]$Method, [hashtable]$Parameters, $Transport) {
  if ($Method -cnotin @('getMe','getChat','getChatMemberCount','getChatMember','sendMessage')) { throw 'Unsupported Telegram method' }
  if ($Transport.Client -isnot [Net.Http.HttpClient]) { throw 'Workflow transport required' }
  $client=$Transport.Client
  $content=$null; $response=$null
  try {
    $content=[Net.Http.StringContent]::new(($Parameters | ConvertTo-Json -Depth 8 -Compress), [Text.Encoding]::UTF8, 'application/json')
    $response=$client.PostAsync("https://api.telegram.org/bot$Token/$Method", $content).GetAwaiter().GetResult()
    return ConvertFrom-CurrentTelegramResponse ([int]$response.StatusCode) ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult())
  } finally {
    if ($response) { $response.Dispose() }; if ($content) { $content.Dispose() }
    $Token=$null; $body=$null; $client=$null
  }
}

function Write-CurrentDeliveryReceipt([IO.FileStream]$Stream, [hashtable]$Receipt) {
  $bytes=[Text.Encoding]::UTF8.GetBytes(($Receipt | ConvertTo-Json -Depth 8 -Compress))
  $Stream.Position=0
  $Stream.SetLength(0)
  $Stream.Write($bytes,0,$bytes.Length)
  $Stream.Flush($true)
}

function Invoke-CurrentReportDelivery {
  param([string]$RepoRoot, [string]$InputPath, [string]$Operation, [string]$ChatId,
    [string]$BotId, [string]$BotUsername, [string]$WindowsSid, [string]$ReportHash,
    [string]$Receipts, [switch]$PrepareOnly, [switch]$SendOnce,
    [string]$Kind='private', [string[]]$MemberIds, [string]$AudienceHash)
  $receipt=@{ Format='schoology-current-delivery-receipt/v1'; State='INPUT_REFUSED'; OperationId=$null;
    CredentialLookups=0; MetadataRequests=0; SendAttempts=0; PhoneAcceptance=$false }
  $failure='INPUT_REFUSED'; $lease=$null; $token=$null; $report=$null; $transport=$null
  try {
    if ([bool]$PrepareOnly -eq [bool]$SendOnce) { throw 'Choose one explicit mode' }
    if ($Kind -cnotin @('private','group')) { throw 'Explicit supported recipient type required' }
    $group=($Kind -ceq 'group')
    $audience=$null
    if ($group) { $audience=Get-CurrentGroupAudience $ChatId $BotId $MemberIds }
    elseif ($MemberIds.Count -gt 0 -or $AudienceHash) { throw 'Group fields require explicit group mode' }
    $report=Get-CurrentDeliveryReport $RepoRoot $InputPath
    $receipt.ReportSha256=$report.Sha256
    $receipt.ReportCharacters=$report.Characters
    $receipt.ObservedAt=$report.ObservedAt
    if ($group) { $receipt.RecipientType='group'; $receipt.AudienceSha256=$audience.Sha256; $receipt.DeclaredMemberCount=$audience.MemberCount }
    if ($PrepareOnly) { $receipt.State='PREPARED_NO_CREDENTIAL_OR_PROVIDER_USE'; return $receipt }
    if ($Operation -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' -or
      (-not $group -and $ChatId -cnotmatch '^[1-9][0-9]{0,15}$') -or $BotId -cnotmatch '^[1-9][0-9]{0,15}$' -or $ChatId -ceq $BotId -or
      $BotUsername -cnotmatch '^[A-Za-z0-9_]{5,32}$' -or $WindowsSid -cnotmatch '^S-1-5-21-[0-9-]+$' -or
      $ReportHash -notmatch '^[a-fA-F0-9]{64}$' -or $ReportHash.ToLowerInvariant() -cne $report.Sha256 -or
      ($group -and ($AudienceHash -notmatch '^[a-fA-F0-9]{64}$' -or $AudienceHash.ToLowerInvariant() -cne $audience.Sha256)) -or
      -not [IO.Directory]::Exists($Receipts)) { throw 'Exact delivery binding required' }
    $receipt.OperationId=$Operation
    $receipt.BotId=$BotId; $receipt.BotUsername=$BotUsername; $receipt.RecipientChatId=$ChatId
    $binding=Get-DeliveryHash "$BotId`n$BotUsername`n$ChatId`n$($report.Sha256)`n$WindowsSid"
    $receipt.BindingSha256=$binding
    # Group sends are the same external effect despite changed audience claims,
    # public bot name or caller SID. Keep the older private claim unchanged.
    $effect=if ($group) { Get-DeliveryHash "schoology-current-group-send-effect/v1`n$BotId`n$ChatId`n$($report.Sha256)" } else { $binding }
    if ($group) { $receipt.EffectSha256=$effect }
    $failure='EXISTING_RECEIPT_DO_NOT_RETRY'
    $lease=[IO.FileStream]::new((Join-Path $Receipts "$Operation.json"), [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    $receipt.State='RESERVED'
    Write-CurrentDeliveryReceipt $lease $receipt
    # Also refuse a second operation name for the identical external effect.
    $failure='EXISTING_PAYLOAD_CLAIM_DO_NOT_RETRY'
    $claim=[IO.FileStream]::new((Join-Path $Receipts "$effect.claim"), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $claimBytes=[Text.Encoding]::UTF8.GetBytes($Operation); $claim.Write($claimBytes,0,$claimBytes.Length); $claim.Flush($true) } finally { $claim.Dispose() }
    $failure='AUTH_ESCALATION_CREDENTIAL'
    $receipt.CredentialLookups=1; $receipt.State='CREDENTIAL_LOOKUP_RESERVED'
    Write-CurrentDeliveryReceipt $lease $receipt
    $token=Get-CurrentBotCredential $RepoRoot $WindowsSid
    if ($token -cnotmatch '^[0-9]{5,20}:[A-Za-z0-9_-]{20,}$') { throw 'Existing token unavailable or malformed' }
    $failure='TRANSPORT_INIT_UNVERIFIED'
    $transport=New-CurrentTelegramTransport
    $failure='AUTH_ESCALATION_BOT_IDENTITY'
    $receipt.MetadataRequests=1; $receipt.State='BOT_IDENTITY_RESERVED'
    $receipt.LastRequestMethod='getMe'; $receipt.RequestCompleted=$false; $receipt.LastHttpStatus=$null; $receipt.LastApiOk=$null; $receipt.RetryAfterSeconds=$null
    Write-CurrentDeliveryReceipt $lease $receipt
    $self=Invoke-CurrentTelegramRequest $token 'getMe' @{} $transport
    $receipt.RequestCompleted=$true; $receipt.LastApiOk=$self.Success; $receipt.LastCompletedMetadataRequests=1
    $receipt.LastHttpStatus=$self.Status; $receipt.RetryAfterSeconds=$self.RetryAfterSeconds
    if (-not $self.Success -or $self.Result.is_bot -isnot [bool] -or -not $self.Result.is_bot -or
      [string]$self.Result.id -cne $BotId -or $self.Result.username -cne $BotUsername) { throw 'Bot identity mismatch' }
    $failure=if ($group) { 'AUTH_ESCALATION_GROUP_RECIPIENT' } else { 'AUTH_ESCALATION_PRIVATE_RECIPIENT' }
    $receipt.MetadataRequests=2; $receipt.State=if ($group) { 'GROUP_RECIPIENT_RESERVED' } else { 'PRIVATE_RECIPIENT_RESERVED' }
    $receipt.LastRequestMethod='getChat'; $receipt.RequestCompleted=$false; $receipt.LastHttpStatus=$null; $receipt.LastApiOk=$null; $receipt.RetryAfterSeconds=$null
    Write-CurrentDeliveryReceipt $lease $receipt
    $chat=Invoke-CurrentTelegramRequest $token 'getChat' @{chat_id=$ChatId} $transport
    $receipt.RequestCompleted=$true; $receipt.LastApiOk=$chat.Success; $receipt.LastCompletedMetadataRequests=2
    $receipt.LastHttpStatus=$chat.Status; $receipt.RetryAfterSeconds=$chat.RetryAfterSeconds
    if (-not $chat.Success -or [string]$chat.Result.id -cne $ChatId -or $chat.Result.type -cne $Kind) { throw 'Recipient mismatch' }
    if ($group) {
      $failure='AUTH_ESCALATION_GROUP_AUDIENCE'
      $receipt.MetadataRequests++; $receipt.State='GROUP_MEMBER_COUNT_RESERVED'
      $receipt.LastRequestMethod='getChatMemberCount'; $receipt.RequestCompleted=$false; $receipt.LastHttpStatus=$null; $receipt.LastApiOk=$null; $receipt.RetryAfterSeconds=$null
      Write-CurrentDeliveryReceipt $lease $receipt
      $count=Invoke-CurrentTelegramRequest $token 'getChatMemberCount' @{chat_id=$ChatId} $transport
      $receipt.RequestCompleted=$true; $receipt.LastApiOk=$count.Success; $receipt.LastCompletedMetadataRequests=$receipt.MetadataRequests
      $receipt.LastHttpStatus=$count.Status; $receipt.RetryAfterSeconds=$count.RetryAfterSeconds
      if (-not (Test-CurrentGroupMemberCount $count $audience.MemberCount)) { throw 'Group member count mismatch' }
      foreach ($id in @($BotId)+@($audience.MemberIds)) {
        $receipt.MetadataRequests++; $receipt.State='GROUP_MEMBER_IDENTITY_RESERVED'
        $receipt.LastRequestMethod='getChatMember'; $receipt.RequestCompleted=$false; $receipt.LastHttpStatus=$null; $receipt.LastApiOk=$null; $receipt.RetryAfterSeconds=$null
        Write-CurrentDeliveryReceipt $lease $receipt
        $member=Invoke-CurrentTelegramRequest $token 'getChatMember' @{chat_id=$ChatId;user_id=$id} $transport
        $receipt.RequestCompleted=$true; $receipt.LastApiOk=$member.Success; $receipt.LastCompletedMetadataRequests=$receipt.MetadataRequests
        $receipt.LastHttpStatus=$member.Status; $receipt.RetryAfterSeconds=$member.RetryAfterSeconds
        if (-not (Test-CurrentGroupMember $member $id ($id -ceq $BotId) $BotUsername)) { throw 'Group member identity mismatch' }
      }
      # Recheck size after identities; metadata never grants consent or protects
      # against later group membership changes. The live tuple remains external.
      $receipt.MetadataRequests++; $receipt.State='GROUP_MEMBER_COUNT_RECHECK_RESERVED'
      $receipt.LastRequestMethod='getChatMemberCount'; $receipt.RequestCompleted=$false; $receipt.LastHttpStatus=$null; $receipt.LastApiOk=$null; $receipt.RetryAfterSeconds=$null
      Write-CurrentDeliveryReceipt $lease $receipt
      $count=Invoke-CurrentTelegramRequest $token 'getChatMemberCount' @{chat_id=$ChatId} $transport
      $receipt.RequestCompleted=$true; $receipt.LastApiOk=$count.Success; $receipt.LastCompletedMetadataRequests=$receipt.MetadataRequests
      $receipt.LastHttpStatus=$count.Status; $receipt.RetryAfterSeconds=$count.RetryAfterSeconds
      if (-not (Test-CurrentGroupMemberCount $count $audience.MemberCount)) { throw 'Group membership changed' }
      $receipt.VerifiedMemberCount=$audience.MemberCount
    }
    $failure='SNAPSHOT_EXPIRED_BEFORE_SEND'
    if ((Get-DeliveryUtcNow) - [DateTimeOffset]::Parse($report.ObservedAt) -gt [TimeSpan]::FromMinutes(15)) { throw 'Refresh current snapshot before sending' }
    $failure='SEND_UNKNOWN_DO_NOT_RETRY'
    $receipt.SendAttempts=1; $receipt.State='SEND_RESERVED'
    $receipt.LastRequestMethod='sendMessage'; $receipt.RequestCompleted=$false; $receipt.LastHttpStatus=$null; $receipt.LastApiOk=$null; $receipt.RetryAfterSeconds=$null
    Write-CurrentDeliveryReceipt $lease $receipt
    $sent=Invoke-CurrentTelegramRequest $token 'sendMessage' @{chat_id=$ChatId; text=$report.Text; link_preview_options=@{is_disabled=$true}; allow_paid_broadcast=$false} $transport
    $receipt.RequestCompleted=$true; $receipt.LastApiOk=$sent.Success
    $receipt.LastHttpStatus=$sent.Status; $receipt.RetryAfterSeconds=$sent.RetryAfterSeconds
    if (-not $sent.Success) { $failure='SEND_REFUSED_DO_NOT_RETRY'; throw 'Send refused' }
    if ($sent.Result.message_id -isnot [int] -and $sent.Result.message_id -isnot [long]) { throw 'Message receipt unavailable' }
    if ($sent.Result.message_id -le 0 -or [string]$sent.Result.chat.id -cne $ChatId -or $sent.Result.chat.type -cne $Kind -or
      [string]$sent.Result.from.id -cne $BotId -or $sent.Result.from.is_bot -isnot [bool] -or -not $sent.Result.from.is_bot -or
      $sent.Result.text -cne $report.Text) { throw 'Message receipt mismatch' }
    $receipt.MessageId=$sent.Result.message_id
    $receipt.State='DELIVERED_API_VERIFIED_PHONE_PENDING'
    Write-CurrentDeliveryReceipt $lease $receipt
    return $receipt
  } catch {
    # Never emit exception messages/stacks, URLs, provider descriptions, token,
    # input records or report text. A send timeout consumes its one attempt.
    $receipt.FailedStage=$receipt.State
    $receipt.ErrorClassChain=@()
    $exception=$_.Exception
    while ($exception -and $receipt.ErrorClassChain.Count -lt 8) {
      $receipt.ErrorClassChain+=@($exception.GetType().Name)
      $exception=$exception.InnerException
    }
    if ($receipt.SendAttempts -eq 0 -and $receipt.RequestCompleted -eq $false -and
      @($receipt.ErrorClassChain | Where-Object { $_ -in @('TaskCanceledException','OperationCanceledException','TimeoutException','HttpRequestException') }).Count -gt 0) {
      $failure='METADATA_TRANSPORT_UNVERIFIED'
    }
    $receipt.State=$failure
    if ($lease) { try { Write-CurrentDeliveryReceipt $lease $receipt } catch {} }
    return $receipt
  } finally { if ($transport) { Close-CurrentTelegramTransport $transport }; if ($lease) { $lease.Dispose() }; $token=$null; $report=$null; $self=$null; $chat=$null; $sent=$null; $member=$null; $count=$null; $audience=$null; $transport=$null; $exception=$null }
}

$membersForCall=@()
if ($GroupMemberIds) { $membersForCall=@($GroupMemberIds | ForEach-Object { $_ -split ',' }) }
$result=Invoke-CurrentReportDelivery -RepoRoot ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) -InputPath $SnapshotPath -Operation $OperationId -ChatId $RecipientChatId -BotId $ExpectedBotId -BotUsername $ExpectedBotUsername -WindowsSid $ExpectedWindowsSid -ReportHash $ExpectedReportSha256 -Receipts $ReceiptDirectory -PrepareOnly:$Prepare -SendOnce:$Send -Kind $RecipientType -MemberIds $membersForCall -AudienceHash $ExpectedAudienceSha256
$result | ConvertTo-Json -Depth 8 -Compress
if ($result.State -cnotin @('PREPARED_NO_CREDENTIAL_OR_PROVIDER_USE','DELIVERED_API_VERIFIED_PHONE_PENDING')) { exit 2 }
