import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCurrentSummary } from '../src/current_summary.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const sender=path.join(root,'scripts/send_current_schoology_report.ps1');
const harness=path.join(root,'tests/helpers/current_telegram_delivery_cases.ps1');
const candidates=['pwsh',...(process.platform==='win32'?[path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe')]:[])];
const shell=candidates.find(command=>spawnSync(command,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{encoding:'utf8',windowsHide:true,timeout:10000}).stdout?.trim()==='7');
assert.ok(shell,'PowerShell 7 is required for the actual operator-path tests; no silent platform skip.');
const privateMarker='SYNTHETIC_PRIVATE_ASSIGNMENT';
const fakeToken='12345'+':'+('x'.repeat(35));
function fixture(t,changes={}){
  const directory=mkdtempSync(path.join(tmpdir(),'schoology-once-'));
  const receipts=path.join(directory,'receipts');mkdirSync(receipts);
  const snapshot={format:'schoology-current-assignments/v1',sourceOrigin:'https://bcps.schoology.com',observedAt:new Date(Date.now()-1000).toISOString(),complete:true,assignments:[{course:'Fixture Course',title:privateMarker,dueDate:'2020-01-01',status:'Missing',isMissing:true,url:'/assignment/100'}],...changes};
  const input=path.join(directory,'snapshot.json');writeFileSync(input,JSON.stringify(snapshot));
  t.after(()=>{
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));
    assert.ok(path.basename(directory).startsWith('schoology-once-'));
    rmSync(directory,{recursive:true,force:true});
  });
  return {directory,receipts,snapshot,input};
}
function invoke(file,args){
  const child=spawnSync(shell,['-NoProfile','-NonInteractive','-File',file,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.ifError(child.error);assert.equal(child.stderr,'');
  assert.ok(!child.stdout.includes(fakeToken),'Credential value must not enter any output');
  assert.ok(!child.stdout.includes(privateMarker),'Report text must not enter any output or receipt');
  return {child,result:JSON.parse(child.stdout.trim())};
}
function runCase(t,name,changes={}){
  const f=fixture(t,changes);
  const text=buildCurrentSummary(f.snapshot).summaryText.trimEnd();
  const hash=createHash('sha256').update(text).digest('hex');
  const {child,result}=invoke(harness,['-RepoRoot',root,'-SnapshotPath',f.input,'-ReceiptDirectory',f.receipts,'-CaseName',name,'-ReportHash',hash]);
  assert.equal(child.status,0);return {f,result};
}

test('actual Prepare CLI formats fresh input without credential, provider or receipt writes',t=>{
  const f=fixture(t);const before=readFileSync(f.input);
  const {child,result}=invoke(sender,['-SnapshotPath',f.input,'-Prepare']);
  assert.equal(child.status,0);assert.equal(result.State,'PREPARED_NO_CREDENTIAL_OR_PROVIDER_USE');
  assert.equal(result.ReportSha256,createHash('sha256').update(buildCurrentSummary(f.snapshot).summaryText.trimEnd()).digest('hex'));
  assert.equal(result.CredentialLookups,0);assert.equal(result.MetadataRequests,0);assert.equal(result.SendAttempts,0);
  assert.deepEqual(readFileSync(f.input),before);assert.deepEqual(readdirSync(f.receipts),[]);
});

for(const [name,changes] of [['stale',{observedAt:new Date(Date.now()-16*60000).toISOString()}],['oversized',{assignments:[{course:'Fixture',title:'x'.repeat(5000),status:'Missing',isMissing:true}]}]]){
  test(`actual Prepare CLI refuses ${name} input without credential or provider use`,t=>{
    const f=fixture(t,changes);const {child,result}=invoke(sender,['-SnapshotPath',f.input,'-Prepare']);
    assert.equal(child.status,2);assert.equal(result.State,'INPUT_REFUSED');assert.equal(result.CredentialLookups,0);assert.equal(result.SendAttempts,0);
  });
}
test('operator CLI requires an explicit mode and never defaults to send',t=>{
  const f=fixture(t);const {child,result}=invoke(sender,['-SnapshotPath',f.input]);
  assert.equal(child.status,2);assert.equal(result.State,'INPUT_REFUSED');assert.equal(result.CredentialLookups,0);
});

test('actual Prepare preserves an ISO observation offset as text',t=>{
  const observedAt=new Date(Date.now()-4*3600000-1000).toISOString().replace('Z','-04:00');
  const f=fixture(t,{observedAt});const {child,result}=invoke(sender,['-SnapshotPath',f.input,'-Prepare']);
  assert.equal(child.status,0);assert.equal(result.ObservedAt,observedAt);
});

test('actual response parser retains a long provider retry delay and drops error descriptions',t=>{
  const f=fixture(t);const {child,result}=invoke(harness,['-RepoRoot',root,'-SnapshotPath',f.input,'-ReceiptDirectory',f.receipts,'-CaseName','parseRetry']);
  assert.equal(child.status,0);assert.equal(result.Status,429);assert.equal(result.Success,false);assert.equal(result.RetryAfterSeconds,172800);
  assert.equal(Object.hasOwn(result,'description'),false);
});

test('actual sender functions bind bot/private recipient/payload and reserve before one mocked send',t=>{
  const {result}=runCase(t,'success');const receipt=result.Results[0];
  assert.equal(receipt.State,'DELIVERED_API_VERIFIED_PHONE_PENDING');assert.equal(receipt.PhoneAcceptance,false);
  assert.equal(receipt.MessageId,11);assert.equal(receipt.SendAttempts,1);assert.equal(result.CredentialReads,1);
  assert.deepEqual(result.Requests,['getMe','getChat','sendMessage']);assert.equal(result.ReservedBeforeSend,true);assert.equal(result.PayloadOptionsVerified,true);
});
for(const [name,state,requests,lookups] of [
  ['wrongHash','INPUT_REFUSED',[],0],['invalidRecipient','INPUT_REFUSED',[],0],
  ['senderAsRecipient','INPUT_REFUSED',[],0],['invalidOperation','INPUT_REFUSED',[],0],
  ['missingCredential','AUTH_ESCALATION_CREDENTIAL',[],1],['credentialException','AUTH_ESCALATION_CREDENTIAL',[],1],
  ['wrongBot','AUTH_ESCALATION_BOT_IDENTITY',['getMe'],1],['metadata429','AUTH_ESCALATION_BOT_IDENTITY',['getMe'],1],
  ['wrongRecipient','AUTH_ESCALATION_PRIVATE_RECIPIENT',['getMe','getChat'],1],
  ['groupRecipient','AUTH_ESCALATION_PRIVATE_RECIPIENT',['getMe','getChat'],1],
  ['expiredDuringMetadata','SNAPSHOT_EXPIRED_BEFORE_SEND',['getMe','getChat'],1],
  ['existingAmbiguousReceipt','EXISTING_RECEIPT_DO_NOT_RETRY',[],0],
]){
  test(`${name} stops the actual sender before any message`,t=>{
    const {f,result}=runCase(t,name);assert.equal(result.Results[0].State,state);assert.equal(result.Results[0].SendAttempts,0);
    assert.equal(result.CredentialReads,lookups);assert.deepEqual(result.Requests,requests);
    if(name==='metadata429')assert.equal(result.Results[0].RetryAfterSeconds,30);
    if(name==='existingAmbiguousReceipt')assert.equal(readFileSync(path.join(f.receipts,'fixture-operation.json'),'utf8'),'ambiguous existing receipt');
  });
}
for(const [name,state] of [['sendTimeout','SEND_UNKNOWN_DO_NOT_RETRY'],['sendRefused','SEND_REFUSED_DO_NOT_RETRY'],['wrongReturnedText','SEND_UNKNOWN_DO_NOT_RETRY'],['wrongReturnedChat','SEND_UNKNOWN_DO_NOT_RETRY']]){
  test(`${name} consumes one send and never falls back or leaks the error/payload`,t=>{
    const {result}=runCase(t,name);assert.equal(result.Results[0].State,state);assert.equal(result.Results[0].SendAttempts,1);
    assert.deepEqual(result.Requests,['getMe','getChat','sendMessage']);assert.equal(result.ReservedBeforeSend,true);
  });
}
for(const name of ['repeatSuccess','repeatTimeout','differentOperationSamePayload']){
  test(`${name} refuses a second credential use or send through the durable receipt`,t=>{
    const {result}=runCase(t,name);assert.equal(result.Results.length,2);
    assert.equal(result.Results[1].State,name==='differentOperationSamePayload'?'EXISTING_PAYLOAD_CLAIM_DO_NOT_RETRY':'EXISTING_RECEIPT_DO_NOT_RETRY');
    assert.equal(result.Results[1].SendAttempts,0);assert.equal(result.CredentialReads,1);
    assert.deepEqual(result.Requests,['getMe','getChat','sendMessage']);
  });
}
