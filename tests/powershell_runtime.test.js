import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPowerShell7 } from './helpers/powershell_runtime.js';

const privateMarker='PRIVATE_DIAGNOSTIC_MARKER_12345';

test('required runtime can qualify after a simulated fifteen-second startup within the bounded probe',()=>{
  let clock=0,calls=0;
  const result=selectPowerShell7(['fixture-shell'],{now:()=>clock,probe:(command,args,options)=>{
    calls++;assert.equal(command,'fixture-shell');assert.deepEqual(args,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major']);
    assert.equal(options.timeout,30000);assert.equal(options.windowsHide,true);clock+=15000;
    return {status:0,signal:null,stdout:'7\n',stderr:''};
  }});
  assert.equal(result.command,'fixture-shell');assert.equal(calls,1);
  assert.equal(result.attempts[0].verdict,'qualified');assert.equal(result.attempts[0].elapsedMs,15000);
});

test('timeout retains safe subprocess metadata and can select a distinct fallback without exposing output',()=>{
  const visited=[];
  const result=selectPowerShell7(['first','fallback'],{probe:command=>{
    visited.push(command);
    return command==='first'?{status:null,signal:'SIGTERM',stdout:privateMarker,stderr:privateMarker,error:Object.assign(new Error(privateMarker),{code:'ETIMEDOUT'})}:{status:0,stdout:'7',signal:null};
  }});
  assert.equal(result.command,'fallback');assert.deepEqual(visited,['first','fallback']);
  assert.equal(result.attempts[0].verdict,'timeout');assert.equal(result.attempts[0].errorCode,'ETIMEDOUT');assert.equal(result.attempts[0].signal,'SIGTERM');
  assert.ok(!JSON.stringify(result).includes(privateMarker));
});

test('PowerShell7-looking output cannot override failure, interruption or a spawn error',()=>{
  for(const child of [{status:1,stdout:'7'},{status:0,signal:'SIGKILL',stdout:'7'},{status:0,stdout:'7',error:{code:'ETIMEDOUT'}}]){
    const result=selectPowerShell7(['fixture'],{probe:()=>child});assert.equal(result.command,null);assert.notEqual(result.attempts[0].verdict,'qualified');
  }
});

test('missing, unsupported and malformed runtimes remain explicit failures with no silent skip',()=>{
  const result=selectPowerShell7(['missing','old','malformed'],{probe:command=>command==='missing'?{error:{code:'ENOENT'}}:command==='old'?{status:0,stdout:'5'}:{status:0,stdout:'7 '+privateMarker,stderr:privateMarker}});
  assert.equal(result.command,null);assert.deepEqual(result.attempts.map(a=>a.verdict),['not-found','unsupported-version','unparseable-version']);
  assert.ok(!JSON.stringify(result).includes(privateMarker));
});

test('thrown errors and unrecognized metadata never emit arbitrary diagnostic strings',()=>{
  const result=selectPowerShell7(['fixture'],{probe:()=>{throw Object.assign(new Error(privateMarker),{code:privateMarker});}});
  assert.equal(result.command,null);assert.equal(result.attempts[0].errorCode,'OTHER');assert.ok(!JSON.stringify(result).includes(privateMarker));
});

test('caller cannot make the required runtime probe unbounded',()=>{
  for(const timeoutMs of [0,30001,Infinity,1.5])assert.throws(()=>selectPowerShell7(['fixture'],{timeoutMs}),RangeError);
});
