#requires -Version 7.2
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/run_subscription_telegram.ps1')
$passed=0
function Assert-Refused([scriptblock]$Action) {
  $refused=$false
  try { & $Action | Out-Null } catch { $refused=$true }
  if(-not $refused) { throw 'Expected refusal' }
  $script:passed++
}
function New-Message {
  return [pscustomobject]@{message=[pscustomobject]@{chat=[pscustomobject]@{id='-10001'};from=[pscustomobject]@{id='101';is_bot=$false};text='What is missing?';photo=$null;document=$null;voice=$null}}
}
$members=@('101','102')
$good=New-Message
if((Get-RelayMessage $good '-10001' $members).text -cne 'What is missing?'){throw 'Valid message refused'}
$passed++
$bad=New-Message;$bad.message.chat.id='1';Assert-Refused {Get-RelayMessage $bad '-10001' $members}
$bad=New-Message;$bad.message.from.id='999';Assert-Refused {Get-RelayMessage $bad '-10001' $members}
$bad=New-Message;$bad.message.from.is_bot=$true;Assert-Refused {Get-RelayMessage $bad '-10001' $members}
$bad=New-Message;$bad.message.text='x'*8001;Assert-Refused {Get-RelayMessage $bad '-10001' $members}
$bad=New-Message;$bad.message.photo=@('photo');Assert-Refused {Get-RelayMessage $bad '-10001' $members}
$bad=[pscustomobject]@{callback_query=@{data='test'}};Assert-Refused {Get-RelayMessage $bad '-10001' $members}

# Existing durable state must fail before opening a credential or changing it.
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('schoology-relay-test-'+[guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory($temporary)
try {
  $DataDirectory=$temporary;$WorkerDirectory=$temporary;$WorkerThreadId='00000000-0000-0000-0000-000000000001';$MaximumRequests=20;$BotId='999';$ChatId='-10001';$MemberIds=@('101','102');$StudentProfileId='123';$CurrentTerm='MP 1 2026-2027'
  $statePath=Join-Path $temporary 'state.json';[IO.File]::WriteAllText($statePath,'{"state":"SENT","replyId":829}')
  Assert-Refused {Start-SubscriptionRelay}
  if([IO.File]::ReadAllText($statePath) -cne '{"state":"SENT","replyId":829}' -or [IO.File]::Exists((Join-Path $temporary 'relay.lock'))){throw 'Existing state was changed'}
  $passed++
} finally {
  $resolvedTemporary=[IO.Path]::GetFullPath($temporary)
  $resolvedRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(-not $resolvedTemporary.StartsWith($resolvedRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTemporary) -notlike 'schoology-relay-test-*'){throw 'Unexpected cleanup target'}
  [IO.Directory]::Delete($resolvedTemporary,$true)
}
"PASS: $passed offline isolation and state-preservation checks; zero credentials, network, workers or sends"
