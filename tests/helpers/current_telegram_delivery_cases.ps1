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
function Invoke-CurrentTelegramRequest([string]$Token,[string]$Method,[hashtable]$Parameters){
  $script:Requests.Add($Method)
  if($Method -eq 'getMe'){
    if($CaseName -eq 'metadata429'){return [pscustomobject]@{Status=429;Success=$false;RetryAfterSeconds=30;Result=$null}}
    $id=if($CaseName -eq 'wrongBot'){'1001'}else{'1000'}
    return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=[pscustomobject]@{id=$id;is_bot=$true;username='FixtureBot'}}
  }
  if($Method -eq 'getChat'){
    if($CaseName -eq 'expiredDuringMetadata'){$script:ClockOffset=16}
    $id=if($CaseName -eq 'wrongRecipient'){'2001'}else{'2000'}
    $type=if($CaseName -eq 'groupRecipient'){'group'}else{'private'}
    return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=[pscustomobject]@{id=$id;type=$type}}
  }
  $before=Get-Content -LiteralPath (Join-Path $ReceiptDirectory 'fixture-operation.json') -Raw | ConvertFrom-Json
  $script:ReservedBeforeSend=($before.State -ceq 'SEND_RESERVED' -and $before.SendAttempts -eq 1)
  $script:PayloadOptionsVerified=($Parameters.chat_id -ceq '2000' -and $Parameters.allow_paid_broadcast -eq $false -and $Parameters.link_preview_options.is_disabled -eq $true -and -not $Parameters.ContainsKey('parse_mode'))
  if($CaseName -in @('sendTimeout','repeatTimeout')){throw "request https://api.telegram.org/bot$Token/sendMessage $($Parameters.text)"}
  if($CaseName -eq 'sendRefused'){return [pscustomobject]@{Status=403;Success=$false;RetryAfterSeconds=0;Result=$null}}
  $text=if($CaseName -eq 'wrongReturnedText'){'incomplete text'}else{$Parameters.text}
  $id=if($CaseName -eq 'wrongReturnedChat'){'2001'}else{'2000'}
  return [pscustomobject]@{Status=200;Success=$true;RetryAfterSeconds=0;Result=[pscustomobject]@{message_id=11;chat=[pscustomobject]@{id=$id;type='private'};from=[pscustomobject]@{id='1000';is_bot=$true};text=$text}}
}
$binding=@{RepoRoot=$RepoRoot;InputPath=$SnapshotPath;Operation='fixture-operation';ChatId='2000';BotId='1000';BotUsername='FixtureBot';WindowsSid='S-1-5-21-1-2-3-4';ReportHash=$ReportHash;Receipts=$ReceiptDirectory;SendOnce=$true}
if($CaseName -eq 'wrongHash'){$binding.ReportHash=('0'*64)}
if($CaseName -eq 'invalidRecipient'){$binding.ChatId='@unverified'}
if($CaseName -eq 'senderAsRecipient'){$binding.ChatId=$binding.BotId}
if($CaseName -eq 'invalidOperation'){$binding.Operation=$script:FakeToken}
if($CaseName -eq 'existingAmbiguousReceipt'){[IO.File]::WriteAllText((Join-Path $ReceiptDirectory 'fixture-operation.json'),'ambiguous existing receipt')}
$results=@(Invoke-CurrentReportDelivery @binding)
if($CaseName -in @('repeatSuccess','repeatTimeout','differentOperationSamePayload')){
  if($CaseName -eq 'differentOperationSamePayload'){$binding.Operation='different-operation'}
  $results+=@(Invoke-CurrentReportDelivery @binding)
}
$receiptContents=@(Get-ChildItem -LiteralPath $ReceiptDirectory -File | ForEach-Object { [IO.File]::ReadAllText($_.FullName) })
[pscustomobject]@{Results=$results;CredentialReads=$script:CredentialReads;Requests=@($script:Requests);ReservedBeforeSend=$script:ReservedBeforeSend;PayloadOptionsVerified=$script:PayloadOptionsVerified;ReceiptContents=$receiptContents} | ConvertTo-Json -Depth 12 -Compress
