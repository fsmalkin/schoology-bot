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
$poll=New-RelayPollParameters $null
if($poll.allowed_updates.Count -ne 1 -or $poll.allowed_updates[0] -cne 'message' -or $poll.ContainsKey('offset')){throw 'Initial message subscription or offset changed'}
$passed++
$poll=New-RelayPollParameters 123
if($poll.offset -ne 123 -or $poll.allowed_updates[0] -cne 'message'){throw 'Confirmed offset or message subscription lost'}
$passed++

# Existing durable state must fail before opening a credential or changing it.
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('schoology-relay-test-'+[guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory($temporary)
try {
  $DataDirectory=$temporary;$WorkerDirectory=$temporary;$WorkerThreadId='00000000-0000-0000-0000-000000000001';$MaximumRequests=20;$BotId='999';$ChatId='-10001';$MemberIds=@('101','102');$StudentProfileId='123';$CurrentTerm='MP 1 2026-2027'
  $statePath=Join-Path $temporary 'state.json';[IO.File]::WriteAllText($statePath,'{"state":"SENT","replyId":829}')
  Assert-Refused {Start-SubscriptionRelay}
  if([IO.File]::ReadAllText($statePath) -cne '{"state":"SENT","replyId":829}' -or [IO.File]::Exists((Join-Path $temporary 'relay.lock'))){throw 'Existing state was changed'}
  $passed++
  if($null -ne (Get-LocalAnnotationRequest 'What is missing?')){throw 'A question became a local mutation'}
  $passed++
  $request=Get-LocalAnnotationRequest 'Add a note to "Geometry practice": Bring ruler'
  if($request.operation -cne 'note' -or $request.target -cne 'Geometry practice' -or $request.value -cne 'Bring ruler'){throw 'Natural note parse changed'}
  $passed++
  $statusRequest=Get-LocalAnnotationRequest '/status Geometry practice :: F'
  if($statusRequest.value -cne 'Will complete in class'){throw 'Existing status F lost'}
  $passed++
  Assert-Refused {Get-LocalAnnotationRequest '/note https://example.com/assignment/1 :: text'}
  Assert-Refused {Get-LocalAnnotationRequest ('/note Geometry practice :: '+('x'*2001))}
  $assignment=[pscustomobject]@{url='https://bcps.schoology.com/assignment/123';title='Geometry practice';course='Geometry'}
  Assert-Refused {Confirm-LocalAnnotationTarget (Get-LocalAnnotationRequest '/status Other title :: E') $assignment}
  Assert-Refused {Confirm-LocalAnnotationTarget (Get-LocalAnnotationRequest '/status https://bcps.schoology.com/assignment/456 :: E') $assignment}
  $annotationPath=Join-Path $temporary 'annotations.json'
  $annotations=Read-LocalAnnotations $annotationPath '123' 'MP1 2026-2027'
  $reply=Save-LocalAnnotation $annotations $annotationPath $request $assignment 'telegram-update-1'
  $reread=Read-LocalAnnotations $annotationPath '123' 'MP1 2026-2027'
  if($reply -notlike '*local note*' -or $reread.records[$assignment.url].notes[0].text -cne 'Bring ruler'){throw 'Note save/readback failed'}
  $passed++
  $beforeReplay=[IO.File]::ReadAllText($annotationPath)
  Assert-Refused {Save-LocalAnnotation $reread $annotationPath $request $assignment 'telegram-update-1'}
  if([IO.File]::ReadAllText($annotationPath) -cne $beforeReplay){throw 'Duplicate local effect changed data'}
  $passed++
  Assert-Refused {Read-LocalAnnotations $annotationPath '456' 'MP1 2026-2027'}
  [void](Save-LocalAnnotation $reread $annotationPath $statusRequest $assignment 'telegram-update-2')
  $reread=Read-LocalAnnotations $annotationPath '123' 'MP1 2026-2027'
  if($reread.records[$assignment.url].manualStatus -cne 'Will complete in class' -or $reread.records[$assignment.url].notes.Count -ne 1){throw 'Status edit lost the note'}
  $passed++
  [void](Save-LocalAnnotation $reread $annotationPath (Get-LocalAnnotationRequest '/clear-status Geometry practice') $assignment 'telegram-update-3')
  $reread=Read-LocalAnnotations $annotationPath '123' 'MP1 2026-2027'
  if($reread.records[$assignment.url].manualStatus -or $reread.records[$assignment.url].notes.Count -ne 1 -or -not $reread.effects['telegram-update-3'].before.manualStatus){throw 'Status clear lost history or notes'}
  $passed++
  [void](Save-LocalAnnotation $reread $annotationPath (Get-LocalAnnotationRequest '/clear-notes Geometry practice') $assignment 'telegram-update-4')
  $reread=Read-LocalAnnotations $annotationPath '123' 'MP1 2026-2027'
  if($reread.records[$assignment.url].notes.Count -ne 0 -or $reread.effects['telegram-update-4'].before.notes.Count -ne 1){throw 'Note clear lost reversible history'}
  $passed++
} finally {
  $resolvedTemporary=[IO.Path]::GetFullPath($temporary)
  $resolvedRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(-not $resolvedTemporary.StartsWith($resolvedRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTemporary) -notlike 'schoology-relay-test-*'){throw 'Unexpected cleanup target'}
  [IO.Directory]::Delete($resolvedTemporary,$true)
}
"PASS: $passed offline isolation and state-preservation checks; zero credentials, network, workers or sends"
