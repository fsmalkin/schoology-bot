#requires -Version 7.2
param([string]$RepoRoot, [string]$SnapshotPath, [string]$ReceiptDirectory, [string]$CaseName, [string]$ReportHash)
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $RepoRoot 'scripts/send_current_schoology_report.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Sender parse failed'}
foreach($definition in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){
  . ([scriptblock]::Create($definition.Extent.Text))
}

# Define test adapters AFTER the actual functions. No native credential or
# provider function is called, and the operator CLI body is never evaluated.
$script:CredentialReads=0
$script:Requests=[Collections.Generic.List[string]]::new()
$script:ClockOffset=0
$script:ReservedBeforeSend=$false
$script:PayloadOptionsVerified=$false
$script:GroupCountReads=0
$script:TransportCreates=0
$script:TransportCloses=0
$script:FirstTransport=$null
$script:AllRequestsShareTransport=$true
$groupCase=($CaseName -like 'group*' -and $CaseName -ne 'groupRecipient')
$script:FakeToken=('12345'+':'+('x'*35))
if($CaseName -eq 'parseRetry'){
  $json=@{ok=$false;description="request $script:FakeToken";parameters=@{retry_after=172800}} | ConvertTo-Json -Depth 4 -Compress
  ConvertFrom-CurrentTelegramResponse 429 $json | ConvertTo-Json -Depth 4 -Compress
  exit 0
}
function Get-CurrentBotCredential([string]$Root,[string]$Sid){
  $script:CredentialReads++
  if($CaseName -eq 'missingCredential'){return $null}
  if($CaseName -eq 'credentialException'){throw "credential $script:FakeToken"}
  return $script:FakeToken
}
function Get-DeliveryUtcNow {return [DateTimeOffset]::UtcNow.AddMinutes($script:ClockOffset)}
function New-CurrentTelegramTransport {
  $script:TransportCreates++
  return [pscustomobject]@{ Marker='SYNTHETIC_WORKFLOW_ONLY' }
}
function Close-CurrentTelegramTransport($Transport) { $script:TransportCloses++ }
function Invoke-CurrentTelegramRequest([string]$Token,[string]$Method,[hashtable]$Parameters,$Transport){
  $script:Requests.Add($Method)
  if (-not $Transport) { $script:AllRequestsShareTransport=$false }
  elseif (-not $script:FirstTransport) { $script:FirstTransport=$Transport }
  elseif (-not [object]::ReferenceEquals($script:FirstTransport,$Transport)) { $script:AllRequestsShareTransport=$false }
  if($Method -eq 'getMe'){
    if($CaseName -eq 'metadata429'){return [pscustomobject]@{Status=429;Success=$false;RetryAfterSeconds=30;Result=$null}}
    $id=if($CaseName -eq 'wrongBot'){'1001'}else{'1000'}
    return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=[pscustomobject]@{id=$id;is_bot=$true;username='FixtureBot'}}
  }
  if($Method -eq 'getChat'){
    if($CaseName -eq 'expiredDuringMetadata'){$script:ClockOffset=16}
    $id=if($CaseName -in @('wrongRecipient','groupWrongRecipient')){'2001'}elseif($groupCase){'-2000'}else{'2000'}
    $type=if($CaseName -eq 'groupWrongType'){'private'}elseif($groupCase -or $CaseName -eq 'groupRecipient'){'group'}else{'private'}
    return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=[pscustomobject]@{id=$id;type=$type}}
  }
  if($Method -eq 'getChatMemberCount'){
    $script:GroupCountReads++
    if($CaseName -eq 'groupInitialCountTimeout' -or ($CaseName -eq 'groupFinalCountTimeout' -and $script:GroupCountReads -eq 2)){
      throw [Threading.Tasks.TaskCanceledException]::new("request $Token",[TimeoutException]::new("request $Token"))
    }
    if($CaseName -eq 'groupExpiredDuringMetadata' -and $script:GroupCountReads -eq 2){$script:ClockOffset=16}
    $count=if($CaseName -in @('groupExpanded','groupDisabledCountGuard') -or ($CaseName -eq 'groupAudienceDrift' -and $script:GroupCountReads -eq 2)){4}elseif($CaseName -eq 'groupInvalidCount'){'3'}else{3}
    return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=$count}
  }
  if($Method -eq 'getChatMember'){
    if($CaseName -eq 'groupMemberTimeout'){
      throw [Threading.Tasks.TaskCanceledException]::new("request $Token",[TimeoutException]::new("request $Token"))
    }
    if($CaseName -eq 'groupMember429'){return [pscustomobject]@{Status=429;Success=$false;RetryAfterSeconds=172800;Result=$null}}
    if($CaseName -eq 'groupMemberException'){throw "member request $script:FakeToken"}
    $bot=($Parameters.user_id -ceq '1000')
    $id=if($CaseName -eq 'groupWrongHumanId' -and -not $bot){'9999'}else{$Parameters.user_id}
    $isBot=if($CaseName -eq 'groupHumanIsBot' -and -not $bot){$true}else{$bot}
    $status=if(($CaseName -eq 'groupBotLeft' -and $bot) -or ($CaseName -eq 'groupHumanLeft' -and -not $bot)){'left'}elseif(($CaseName -in @('groupBotRestricted','groupBotPermissionString') -and $bot) -or ($CaseName -eq 'groupMembershipString' -and -not $bot)){'restricted'}else{'member'}
    $username=if($CaseName -eq 'groupWrongBotUsername'){'DifferentBot'}else{'FixtureBot'}
    $isMember=if($CaseName -eq 'groupMembershipString' -and -not $bot){'true'}else{$true}
    $canSend=if($CaseName -eq 'groupBotPermissionString' -and $bot){'true'}else{$false}
    return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=[pscustomobject]@{status=$status;is_member=$isMember;can_send_messages=$canSend;user=[pscustomobject]@{id=$id;is_bot=$isBot;username=$username}}}
  }
  $before=Get-Content -LiteralPath (Join-Path $ReceiptDirectory 'fixture-operation.json') -Raw | ConvertFrom-Json
  $script:ReservedBeforeSend=($before.State -ceq 'SEND_RESERVED' -and $before.SendAttempts -eq 1)
  $expectedChat=if($groupCase){'-2000'}else{'2000'}
  $script:PayloadOptionsVerified=($Parameters.chat_id -ceq $expectedChat -and $Parameters.allow_paid_broadcast -eq $false -and $Parameters.link_preview_options.is_disabled -eq $true -and -not $Parameters.ContainsKey('parse_mode'))
  if($CaseName -in @('sendTimeout','repeatTimeout','groupSendTimeout')){throw "request https://api.telegram.org/bot$Token/sendMessage $($Parameters.text)"}
  if($CaseName -eq 'sendRefused'){return [pscustomobject]@{Status=403;Success=$false;RetryAfterSeconds=0;Result=$null}}
  $text=if($CaseName -eq 'wrongReturnedText'){'incomplete text'}else{$Parameters.text}
  $id=if($CaseName -in @('wrongReturnedChat','groupWrongReturnedChat')){'2001'}else{$expectedChat}
  $type=if($groupCase -and $CaseName -ne 'groupWrongReturnedType'){'group'}else{'private'}
  return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=[pscustomobject]@{message_id=11;chat=[pscustomobject]@{id=$id;type=$type};from=[pscustomobject]@{id='1000';is_bot=$true};text=$text}}
}
$binding=@{RepoRoot=$RepoRoot;InputPath=$SnapshotPath;Operation='fixture-operation';ChatId='2000';BotId='1000';BotUsername='FixtureBot';WindowsSid='S-1-5-21-1-2-3-4';ReportHash=$ReportHash;Receipts=$ReceiptDirectory;SendOnce=$true}
if($groupCase){
  $binding.Kind='group';$binding.ChatId='-2000';$binding.MemberIds=@('2000','3000');$binding.AudienceHash=(Get-CurrentGroupAudience $binding.ChatId $binding.BotId $binding.MemberIds).Sha256
  switch($CaseName){
    'groupOmittedAudience' {$binding.AudienceHash=$null}
    'groupWrongAudience' {$binding.AudienceHash=('0'*64)}
    'groupDuplicateMembers' {$binding.MemberIds=@('2000','2000')}
    'groupBotInHumanList' {$binding.MemberIds=@('1000','3000')}
    'groupTooManyMembers' {$binding.MemberIds=@('2000','3000','4000')}
    'groupInvalidHumanId' {$binding.MemberIds=@('2000','@unqualified')}
    'groupPositiveChatId' {$binding.ChatId='2000'}
    'groupUnsupportedType' {$binding.Kind='supergroup'}
    'groupPrivateWithAudience' {$binding.Kind='private';$binding.ChatId='2000'}
    'groupReorderedMembers' {$binding.MemberIds=@('3000','2000')}
    'groupDisabledCountGuard' {function Test-CurrentGroupMemberCount {$true}}
  }
}
if($CaseName -eq 'wrongHash'){$binding.ReportHash=('0'*64)}
if($CaseName -eq 'invalidRecipient'){$binding.ChatId='@unverified'}
if($CaseName -eq 'senderAsRecipient'){$binding.ChatId=$binding.BotId}
if($CaseName -eq 'invalidOperation'){$binding.Operation=$script:FakeToken}
if($CaseName -eq 'existingAmbiguousReceipt'){[IO.File]::WriteAllText((Join-Path $ReceiptDirectory 'fixture-operation.json'),'ambiguous existing receipt')}
$results=@(Invoke-CurrentReportDelivery @binding)
if($CaseName -in @('repeatSuccess','repeatTimeout','differentOperationSamePayload','groupRepeatSuccess','groupDifferentOperation','groupChangedAudience','groupChangedUsername','groupChangedSid')){
  if($CaseName -eq 'differentOperationSamePayload'){$binding.Operation='different-operation'}
  if($CaseName -in @('groupDifferentOperation','groupChangedAudience','groupChangedUsername','groupChangedSid')){$binding.Operation='different-operation'}
  if($CaseName -eq 'groupChangedAudience'){$binding.MemberIds=@('4000','5000');$binding.AudienceHash=(Get-CurrentGroupAudience $binding.ChatId $binding.BotId $binding.MemberIds).Sha256}
  if($CaseName -eq 'groupChangedUsername'){$binding.BotUsername='RenamedBot'}
  if($CaseName -eq 'groupChangedSid'){$binding.WindowsSid='S-1-5-21-1-2-3-5'}
  $results+=@(Invoke-CurrentReportDelivery @binding)
}
$receiptContents=@(Get-ChildItem -LiteralPath $ReceiptDirectory -File | ForEach-Object { [IO.File]::ReadAllText($_.FullName) })
[pscustomobject]@{Results=$results;CredentialReads=$script:CredentialReads;Requests=@($script:Requests);ReservedBeforeSend=$script:ReservedBeforeSend;PayloadOptionsVerified=$script:PayloadOptionsVerified;ReceiptContents=$receiptContents;TransportCreates=$script:TransportCreates;TransportCloses=$script:TransportCloses;AllRequestsShareTransport=$script:AllRequestsShareTransport} | ConvertTo-Json -Depth 12 -Compress
