#requires -Version 7.2
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/run_subscription_telegram.ps1')
$passed=0;$script:methods=@();$script:failure=$null;$script:receiptPath=$null
function Assert-Refused([scriptblock]$Action){$refused=$false;try{& $Action|Out-Null}catch{$refused=$true};if(-not $refused){throw 'Expected refusal'};$script:passed++}
function Invoke-RelayApi($Client,$Token,$Method,$Parameters){
  $saved=Get-Content -LiteralPath $script:receiptPath -Raw|ConvertFrom-Json
  $script:methods+=@($Method)
  if($Method -ceq 'sendChatAction'){
    if($saved.typingState -cne 'RESERVED' -or $saved.typingAttempts -lt 1 -or $Parameters.action -cne 'typing' -or $Parameters.message_thread_id -ne 42){throw 'Typing not reserved or thread bound'}
    if($script:failure -ceq 'typing'){throw 'Fixture typing failure'}
    return $true
  }
  if($Method -ceq 'sendMessage'){
    if($saved.sendAttempts -ne 1 -or $Parameters.reply_parameters.message_id -ne 123 -or $Parameters.message_thread_id -ne 42 -or $Parameters.allow_paid_broadcast -ne $false){throw 'Send not reserved or original-thread bound'}
    if($script:failure -ceq 'send'){throw 'Fixture ambiguous send'}
  } elseif($Method -ceq 'editMessageText'){
    if($saved.state -cne 'FINAL_EDIT_RESERVED' -or $saved.finalEditAttempts -ne 1 -or $Parameters.message_id -ne 500){throw 'Edit not reserved or wrong placeholder'}
    if($script:failure -ceq 'edit'){throw 'Fixture ambiguous edit'}
  } else {throw 'Unexpected method'}
  return [pscustomobject]@{chat=@{id='-10001'};from=@{id='999'};message_id=500;text=$Parameters.text}
}
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('schoology-progress-test-'+[guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory($temporary)
$message=[pscustomobject]@{message_id=123;message_thread_id=42}
$start=[DateTimeOffset]::Parse('2026-10-19T00:00:00Z')
function New-Case {
  $script:methods=@();$script:failure=$null
  $script:receiptPath=Join-Path $temporary ([guid]::NewGuid().ToString()+'.json')
  return @{receipt=[ordered]@{typingAttempts=0;progressSendAttempts=0;sendAttempts=0;finalEditAttempts=0};progress=[pscustomobject]@{startedAt=$start;lastTypingAt=$null;typingDisabled=$false;finished=$false}}
}
try {
  $case=New-Case
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress $start
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(3))
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(4))
  if($case.receipt.typingAttempts -ne 2 -or $case.receipt.sendAttempts -ne 0){throw 'Typing cadence or initial feedback changed'};$passed++
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(10))
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(11))
  if($case.receipt.progressMessageId -or @($script:methods|Where-Object {$_ -ceq 'sendMessage'}).Count -ne 0){throw 'Working native typing created a redundant placeholder'};$passed++
  $result=Send-RelayFinalReply $null $null '999' '-10001' $message 'Validated final answer' $case.receipt $script:receiptPath $case.progress
  if($result.text -cne 'Validated final answer' -or $case.receipt.finalEditAttempts -ne 0 -or $case.receipt.sendAttempts -ne 1 -or $case.receipt.progressSendAttempts -ne 0){throw 'Native typing did not finish with one direct final answer'};$passed++
  Assert-Refused {Send-RelayFinalReply $null $null '999' '-10001' $message 'Duplicate' $case.receipt $script:receiptPath $case.progress}
  $count=$script:methods.Count;Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(20))
  if($script:methods.Count -ne $count){throw 'Feedback continued after final completion'};$passed++
  $case=New-Case
  [void](Send-RelayFinalReply $null $null '999' '-10001' $message 'Fast answer' $case.receipt $script:receiptPath $case.progress)
  if(($script:methods -join ',') -cne 'sendMessage' -or $case.receipt.progressSendAttempts -ne 0){throw 'Fast answer created a placeholder'};$passed++
  $case=New-Case;$script:failure='typing'
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress $start
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(4))
  if($case.receipt.typingAttempts -ne 1 -or -not $case.progress.typingDisabled){throw 'Failed typing was replayed'};$passed++
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(10))
  if($case.receipt.progressMessageId -ne 500 -or $case.receipt.progressFallbackReason -cne 'FAILED_OR_AMBIGUOUS_NO_RETRY' -or $case.receipt.progressSendAttempts -ne 1){throw 'Unavailable typing did not produce one evidence-bound fallback'};$passed++
  [void](Send-RelayFinalReply $null $null '999' '-10001' $message 'Fallback final' $case.receipt $script:receiptPath $case.progress)
  if($case.receipt.finalEditAttempts -ne 1 -or @($script:methods|Where-Object {$_ -ceq 'sendMessage'}).Count -ne 1){throw 'Fallback final duplicated its message'};$passed++
  foreach($failure in @('send','edit')){
    $case=New-Case
    $script:failure='typing'
    Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress $start
    if($failure -ceq 'edit'){
      Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(10))
      $script:failure='edit';Assert-Refused {Send-RelayFinalReply $null $null '999' '-10001' $message 'Final' $case.receipt $script:receiptPath $case.progress}
      if(@($script:methods|Where-Object {$_ -ceq 'sendMessage'}).Count -ne 1){throw 'Ambiguous edit caused a fallback send'};$passed++
    } else {
      $script:failure='send';Assert-Refused {Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress ($start.AddSeconds(10))}
      Assert-Refused {Send-RelayFinalReply $null $null '999' '-10001' $message 'Final' $case.receipt $script:receiptPath $case.progress}
    }
  }
  $case=New-Case;$case.receipt.typingAttempts=76
  Invoke-RelayProgressPulse $null $null '999' '-10001' $message $case.receipt $script:receiptPath $case.progress $start
  if($script:methods.Count -ne 0){throw 'Typing ceiling exceeded'};$passed++
} finally {
  $resolved=[IO.Path]::GetFullPath($temporary);$root=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(-not $resolved.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'schoology-progress-test-*'){throw 'Unexpected cleanup target'}
  [IO.Directory]::Delete($resolved,$true)
}
"PASS: $passed typing/placeholder/final-edit controls; zero real provider, credential, worker or source effects"
