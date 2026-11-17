#requires -Version 7.2
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$relay=Join-Path $repo 'scripts/run_subscription_telegram.ps1'
. $relay
$passed=0
Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
public sealed class RelayFixtureContent : StringContent {
  public bool Disposed;
  public RelayFixtureContent(string body) : base(body) {}
  protected override void Dispose(bool disposing) { Disposed=true; base.Dispose(disposing); }
}
public sealed class RelayFixtureHandler : HttpMessageHandler {
  public int Calls;
  public int Status=200;
  public string Body="{\"ok\":true,\"result\":{\"fixture\":true}}";
  public string Transport="";
  public RelayFixtureContent ResponseContent;
  public HttpContent RequestContent;
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
    Calls++;
    RequestContent=request.Content;
    if(Transport=="HTTP_REQUEST") throw new HttpRequestException("fixture-sensitive-provider-text");
    if(Transport=="CANCELLED") throw new TaskCanceledException("fixture-sensitive-provider-text");
    ResponseContent=new RelayFixtureContent(Body);
    return Task.FromResult(new HttpResponseMessage((HttpStatusCode)Status) { Content=ResponseContent });
  }
}
'@
function Assert-True($Value,[string]$Label){if(-not $Value){throw $Label};$script:passed++}
function Test-ProviderFailure([int]$Status,[string]$Body,[string]$Category,$ApiCode=$null,$RetryAfter=$null,[string]$Method='getUpdates',[string]$Transport=''){
  $handler=[RelayFixtureHandler]::new();$handler.Status=$Status;$handler.Body=$Body;$handler.Transport=$Transport
  $client=[Net.Http.HttpClient]::new($handler)
  try {
    $caught=$null
    try {[void](Invoke-RelayApi $client 'fixture-not-a-real-token' $Method @{offset=123;timeout=20})}catch{$caught=$_.Exception}
    Assert-True ($null -ne $caught) 'Failure was accepted'
    $data=Get-RelayApiFailure $caught
    Assert-True ($null -ne $data -and $data.category -ceq $Category -and $data.method -ceq $Method) 'Failure classification lost'
    Assert-True ($data.apiErrorCode -eq $ApiCode -and $data.retryAfterSeconds -eq $RetryAfter) 'Typed API metadata changed'
    if($Category -eq 'TRANSPORT'){
      Assert-True ($null -eq $data.httpStatus -and $data.transportKind -ceq $Transport) 'Transport classification lost'
    }else{
      Assert-True ($data.httpStatus -eq $Status -and $handler.ResponseContent.Disposed) 'HTTP status or response disposal lost'
    }
    Assert-True ($handler.Calls -eq 1) 'Provider call was retried'
    $disposed=$false;try{[void]$handler.RequestContent.ReadAsStringAsync().GetAwaiter().GetResult()}catch{$disposed=$true}
    Assert-True $disposed 'Request content leaked'
    Assert-True (($caught.ToString()+($data|ConvertTo-Json -Compress)) -notmatch 'fixture-sensitive|fixture-not-a-real-token') 'Private diagnostics leaked'
  }finally{$client.Dispose();$handler.Dispose()}
}
$handler=[RelayFixtureHandler]::new();$client=[Net.Http.HttpClient]::new($handler)
try{
  $value=Invoke-RelayApi $client 'fixture-not-a-real-token' 'getMe' @{}
  Assert-True ($value.fixture -eq $true -and $handler.Calls -eq 1 -and $handler.ResponseContent.Disposed) 'Success contract changed'
  $refused=$false;try{Invoke-RelayApi $client 'fixture-not-a-real-token' 'deleteWebhook' @{}|Out-Null}catch{$refused=$true}
  Assert-True ($refused -and $handler.Calls -eq 1) 'Unsupported method reached transport'
}finally{$client.Dispose();$handler.Dispose()}
Test-ProviderFailure 429 '{"ok":false,"error_code":429,"parameters":{"retry_after":5},"description":"fixture-sensitive-provider-text"}' 'HTTP' 429 5
Test-ProviderFailure 502 '{"ok":false,"error_code":502,"description":"fixture-sensitive-provider-text"}' 'HTTP' 502
Test-ProviderFailure 503 'fixture-sensitive-provider-text' 'HTTP'
Test-ProviderFailure 200 '{"ok":false,"error_code":429,"parameters":{"retry_after":5}}' 'API' 429 5
Test-ProviderFailure 200 '{"ok":false,"error_code":403}' 'API' 403
Test-ProviderFailure 200 'fixture-sensitive-provider-text' 'RESPONSE'
Test-ProviderFailure 200 '{"ok":"true","result":{}}' 'RESPONSE'
foreach($invalid in @('[{"ok":true,"result":{}}]','null','true','42','{}')){
  Test-ProviderFailure 200 $invalid 'RESPONSE'
}
foreach($bad in @('0','-1','61','1.5','"5"','null')){
  Test-ProviderFailure 429 ('{"ok":false,"error_code":429,"parameters":{"retry_after":'+$bad+'}}') 'HTTP' 429
}
Test-ProviderFailure 502 '{"ok":false,"error_code":502,"parameters":{"retry_after":5}}' 'HTTP' 502 $null 'sendMessage'
Test-ProviderFailure 200 '' 'TRANSPORT' $null $null 'getUpdates' 'HTTP_REQUEST'
Test-ProviderFailure 200 '' 'TRANSPORT' $null $null 'getUpdates' 'CANCELLED'

# Run the real main/catch/finally in a generated fixture. Its broker stub throws
# before credential reads; the child has no HTTP fixture or real provider call.
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('schoology-relay-failure-'+[guid]::NewGuid().ToString('N'))
$scripts=Join-Path $temporary 'scripts';[void][IO.Directory]::CreateDirectory($scripts)
$pwsh=(Get-Process -Id $PID).Path
try{
  foreach($name in @('telegram_local_annotations.ps1','telegram_connected_browser.ps1','telegram_progress.ps1','telegram_displayed_context.ps1')){
    [IO.File]::Copy((Join-Path $repo ('scripts/'+$name)),(Join-Path $scripts $name))
  }
  [IO.File]::WriteAllText((Join-Path $scripts 'manage_schoology_secrets.ps1'),"function Add-CredentialManagerType { throw 'Fixture broker unavailable' }")
  $baseline=& git -C $repo show 'be6fe2481cf7ba7cbcc3b2ebe9f8d659f448e6e4:scripts/run_subscription_telegram.ps1'
  if($LASTEXITCODE -ne 0){throw 'Exact baseline unavailable'}
  foreach($variant in @('baseline','candidate')){
    $data=Join-Path $temporary $variant;[void][IO.Directory]::CreateDirectory($data)
    $entry=Join-Path $scripts 'run_subscription_telegram.ps1'
    if($variant -eq 'baseline'){[IO.File]::WriteAllText($entry,($baseline -join "`n"))}else{[IO.File]::Copy($relay,$entry,$true)}
    $config=@{dataDirectory=$data;workerThreadId='00000000-0000-0000-0000-000000000001';workerDirectory=$temporary;botId='999';botUsername='SchoologyBot';chatId='-10001';memberIds=@('101','102');studentProfileId='123';currentTerm='MP 1 2026-2027';maximumRequests=1}
    $configPath=Join-Path $data 'config.json';[IO.File]::WriteAllText($configPath,($config|ConvertTo-Json -Compress))
    $start=[Diagnostics.ProcessStartInfo]::new($pwsh);$start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    foreach($arg in @('-NoProfile','-NonInteractive','-File',$entry,'-ConfigPath',$configPath)){$start.ArgumentList.Add($arg)}
    $child=[Diagnostics.Process]::new();$child.StartInfo=$start
    try{
      [void]$child.Start();$stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
      if(-not $child.WaitForExit(15000)){$child.Kill($true);$child.WaitForExit();throw 'Fixture timeout'}
      $out=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult()
      $state=[IO.File]::ReadAllText((Join-Path $data 'state.json'))|ConvertFrom-Json
      Assert-True ($state.state -ceq 'HELD_NO_AUTOMATIC_REPLAY' -and $state.failedStage -ceq 'STARTING') 'Held state not preserved'
      Assert-True ($state.requests -eq 0 -and $state.polls -eq 0 -and $state.paidApiCalls -eq 0 -and [IO.File]::Exists((Join-Path $data 'relay.lock'))) 'Fixture reached effects or lost custody'
      Assert-True ($child.ExitCode -eq $(if($variant -eq 'baseline'){0}else{2})) 'Held process exit did not discriminate baseline'
      Assert-True (($out+$err) -notmatch 'fixture-sensitive|fixture-not-a-real-token') 'Fixture diagnostics leaked'
    }finally{if($child.Id -and -not $child.HasExited){$child.Kill($true);$child.WaitForExit()};$child.Dispose()}
  }
}finally{
  $target=[IO.Path]::GetFullPath($temporary);$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(-not $target.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -notlike 'schoology-relay-failure-*'){throw 'Unexpected fixture cleanup target'}
  Remove-Item -LiteralPath $target -Recurse -Force
}
"PASS: $passed failure/cleanup/entry checks; fake HTTP only, zero real credentials/providers/workers/sends"
