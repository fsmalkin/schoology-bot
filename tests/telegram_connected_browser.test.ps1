#requires -Version 7.2
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/run_subscription_telegram.ps1')
$passed=0
function Assert-Refused([scriptblock]$Action){
  $refused=$false;try{& $Action|Out-Null}catch{$refused=$true}
  if(-not $refused){throw 'Expected refusal'};$script:passed++
}
$contract=@{captureCode='EXACT_APP_CAPTURE'}
$event=@{type='item.completed';item=@{id='capture-1';type='mcp_tool_call';server='node_repl';tool='js';arguments=@{code='EXACT_APP_CAPTURE'};result=@{content=@(@{type='text';text='SCHOOLOGY_SOURCE_V1:{"browserId":"3","sourceTabId":"fixture-tab"}'})};status='completed';error=$null}}|ConvertTo-Json -Depth 12 -Compress
$validated=Confirm-RelayBrowserWorkerEvents $event $contract
if($validated.browserToolCalls -ne 1 -or $validated.capture.browserSource.sourceTabId -cne 'fixture-tab'){throw 'Exact captured browser result lost'};$passed++
Assert-Refused {Confirm-RelayBrowserWorkerEvents '{"type":"item.completed","item":{"type":"agent_message"}}' $contract}
Assert-Refused {Confirm-RelayBrowserWorkerEvents ($event.Replace('node_repl','other_server')) $contract}
Assert-Refused {Confirm-RelayBrowserWorkerEvents ($event.Replace('"js"','"shell"')) $contract}
Assert-Refused {Confirm-RelayBrowserWorkerEvents ($event.Replace('"mcp_tool_call"','"command_execution"')) $contract}
Assert-Refused {Confirm-RelayBrowserWorkerEvents ($event+"`n"+$event) $contract}
Assert-Refused {Confirm-RelayBrowserWorkerEvents ($event.Replace('SCHOOLOGY_SOURCE_V1:','UNBOUND_RESULT:')) $contract}
Assert-Refused {Confirm-RelayBrowserWorkerEvents ($event.Replace('EXACT_APP_CAPTURE','unrelated no-op')) $contract}
$plan=[pscustomobject]@{state='ok';conciseReply='';toolName='list_assignments';argumentsJson='{}'}
$captured=Add-RelayCapturedSource $plan $validated
if($captured.browserSource.sourceTabId -cne 'fixture-tab' -or $captured.sourceStatus -cne 'verified'){throw 'Tool result was not used as source'};$passed++
Assert-Refused {Add-RelayCapturedSource ([pscustomobject]@{browserSource=@{fabricated='rows'}}) $validated}

$script:fixtureCalls=@();$script:fixtureWorkerCalls=0;$script:fixtureImportMode='ok';$script:fixtureReceiptPath=$null
$script:fixturePlan=[pscustomobject]@{state='ok';conciseReply='';toolName='list_assignments';argumentsJson='{"status":"missing"}';sourceStatus='verified';browserSource=[pscustomobject]@{source='validated by JS fixtures'}}
function Invoke-RelayWorker { $script:fixtureWorkerCalls++;return $script:fixturePlan }
function Invoke-OriginalSchoologyTool($NodeExecutable,$PrivateConfig,$InputValue){
  $script:fixtureCalls+=@($InputValue.command)
  switch($InputValue.command){
    'catalog' {return @{source=@{observed_at='2000-01-01T00:00:00Z'};assignments=@()}}
    'import-browser-source' {
      $saved=Get-Content -LiteralPath $script:fixtureReceiptPath -Raw|ConvertFrom-Json
      if($saved.state -cne 'SOURCE_IMPORT_RESERVED' -or $saved.sourceImportAttempts -ne 1 -or $saved.sourceOperationId -cne $InputValue.operationId){throw 'Import was not durably reserved'}
      if($script:fixtureImportMode -eq 'throw'){throw 'Fixture ambiguous import'}
      if($script:fixtureImportMode -eq 'ambiguous'){return @{ok=$true;operationId='wrong'}}
      return @{ok=$true;operationId=$InputValue.operationId;sourceSha256=('a'*64);observedAt='2026-10-19T00:00:00Z';assignments=2}
    }
    'execute' {
      if($InputValue.operationId -notmatch '^telegram-update-[0-9]+$'){throw 'Original effect identity lost'}
      if($script:fixturePlan.sourceStatus -eq 'verified'){
        $saved=Get-Content -LiteralPath $script:fixtureReceiptPath -Raw|ConvertFrom-Json
        if($saved.sourceSha256 -cne ('a'*64) -or $saved.sourceImportAttempts -ne 1){throw 'Tool ran before source confirmation'}
      }
      return @{ok=$true;reply='Saved Schoology data observed 2026-10-19T00:00:00Z';observedAt='2026-10-19T00:00:00Z'}
    }
    default {throw 'Unexpected app command'}
  }
}
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('schoology-browser-flow-test-'+[guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory($temporary)
$script:fixtureCase=0
function Run-Case($Question='What is missing?',$LocalRequest=$null){
  $script:fixtureCase++;$script:fixtureCalls=@();$script:fixtureWorkerCalls=0
  $script:fixtureReceiptPath=Join-Path $temporary ("receipt-$script:fixtureCase.json")
  $receipt=[ordered]@{updateId=$script:fixtureCase;state='WORKER_RESERVED';workerCalls=0;sendAttempts=0}
  $answer=Invoke-RelayOriginalToolRequest 'unused-node' 'unused-config' 'unused-worker' 'same-thread' 'same-directory' $Question 'unused-output' '123' 'MP 1 2026-2027' $LocalRequest $receipt $script:fixtureReceiptPath @{browserId='3'}
  return @{answer=$answer;receipt=$receipt}
}
try {
  $result=Run-Case
  if(($script:fixtureCalls -join ',') -cne 'catalog,import-browser-source,execute' -or $script:fixtureWorkerCalls -ne 1 -or $result.receipt.toolCalls -ne 1){throw 'Read path did not import once before original tool'};$passed++
  $result=Run-Case '/refresh'
  if(($script:fixtureCalls -join ',') -cne 'catalog,import-browser-source' -or $result.answer.conciseReply -notlike 'Refreshed 2*'){throw 'Refresh launched a second source path or lost result'};$passed++
  $result=Run-Case '/note Exact title :: Keep note' @{operation='note';target='Exact title';value='Keep note'}
  if(($script:fixtureCalls -join ',') -cne 'catalog,import-browser-source,execute' -or $result.receipt.toolName -cne 'add_assignment_note'){throw 'Local edit did not use fresh original tool'};$passed++
  foreach($mode in @('throw','ambiguous')){
    $script:fixtureImportMode=$mode
    Assert-Refused {Run-Case}
    if(($script:fixtureCalls -join ',') -cne 'catalog,import-browser-source'){throw 'An ambiguous import reached the original effect'};$passed++
    $saved=Get-Content -LiteralPath $script:fixtureReceiptPath -Raw|ConvertFrom-Json
    if($saved.state -cne 'SOURCE_IMPORT_RESERVED' -or $saved.sourceImportAttempts -ne 1){throw 'Ambiguous import accounting lost'};$passed++
  }
  $script:fixtureImportMode='ok';$script:fixturePlan.sourceStatus='unavailable';$script:fixturePlan.browserSource=$null
  $result=Run-Case
  if(($script:fixtureCalls -join ',') -cne 'catalog,execute' -or $result.answer.conciseReply -notlike 'Current Schoology could not be verified*Saved Schoology data observed*'){throw 'Saved fallback hid source failure/time'};$passed++
  $result=Run-Case '/refresh'
  if(($script:fixtureCalls -join ',') -cne 'catalog' -or $result.answer.state -cne 'unavailable'){throw 'Unavailable refresh reached another source path'};$passed++
  $result=Run-Case '/status Exact title :: E' @{operation='status';target='Exact title';value='E'}
  if(($script:fixtureCalls -join ',') -cne 'catalog' -or $result.answer.conciseReply -notlike '*no local change was saved*'){throw 'Unavailable source permitted a local change'};$passed++
  $script:fixturePlan.sourceStatus='verified'
  Assert-Refused {Run-Case}
  if(($script:fixtureCalls -join ',') -cne 'catalog'){throw 'Missing verified source reached an effect'};$passed++
  $script:fixturePlan.state='unavailable';$script:fixturePlan.conciseReply='Which listed assignment do you mean?'
  $result=Run-Case 'What about item99?'
  if(($script:fixtureCalls -join ',') -cne 'catalog' -or $result.answer.conciseReply -cne 'Which listed assignment do you mean?' -or $result.receipt.toolCalls -ne 0 -or $result.receipt.sourceImportAttempts -ne 0){throw 'Clarification stopped the request or caused an import/tool effect'};$passed++
  if($result.receipt.state -cne 'PLAN_UNAVAILABLE' -or $result.receipt.sourceReadAttempts -ne 1){throw 'Clarification lost its actual source read and no-import boundary'};$passed++
  $script:fixturePlan.state='ok';$script:fixturePlan.conciseReply='';$script:fixturePlan.sourceStatus='unavailable'
  $result=Run-Case 'A new supported question'
  if(($script:fixtureCalls -join ',') -cne 'catalog,execute'){throw 'A subsequent supported request failed after clarification'};$passed++
} finally {
  $resolved=[IO.Path]::GetFullPath($temporary);$root=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(-not $resolved.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'schoology-browser-flow-test-*'){throw 'Unexpected cleanup target'}
  [IO.Directory]::Delete($resolved,$true)
}
"PASS: $passed connected-browser flow controls; zero real browsers, workers, credentials, network or sends"
