import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectPowerShell7} from './helpers/powershell_runtime.js';

const runtime=selectPowerShell7(['pwsh','C:/Users/Fred/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe']);
assert.ok(runtime.command,`PowerShell7 required: ${JSON.stringify(runtime.attempts)}`);
const importer=fileURLToPath(new URL('../scripts/manage_schoology_secrets.ps1',import.meta.url));
const marker='SYNTHETIC-INPUT-NO-ACTUAL-CREDENTIAL';
const wrapper=String.raw`
param([string]$Mode,[string]$Importer,[string]$Fixture)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
namespace SchoologyBot {
  public static class CredentialManager {
    public static Dictionary<string,string> Entries = new Dictionary<string,string>();
    public static List<string> Targets = new List<string>();
    public static int Reads = 0;
    public static bool Corrupt = false;
    public static string Read(string target) {
      Reads++; string value;
      return Entries.TryGetValue(target,out value) ? (Corrupt ? "different-synthetic-value" : value) : null;
    }
    public static void Write(string target,string username,string value) {
      if(username != "schoology-bot") throw new Exception("Unexpected synthetic username");
      Targets.Add(target); Entries[target]=value;
    }
  }
}
'@
$global:Prompts=0
$global:SecurePrompt=$true
function global:Read-Host {
  param([switch]$AsSecureString,[string]$Prompt)
  $global:Prompts++
  $global:SecurePrompt=$global:SecurePrompt -and [bool]$AsSecureString
  if ($Mode -eq 'empty') { return New-Object System.Security.SecureString }
  return ConvertTo-SecureString 'SYNTHETIC-INPUT-NO-ACTUAL-CREDENTIAL' -AsPlainText -Force
}
if($Mode -eq 'existing') {
  [SchoologyBot.CredentialManager]::Entries['schoology-bot/prod/ANTHROPIC_API_KEY']='synthetic-existing'
}
if($Mode -eq 'bad-readback') { [SchoologyBot.CredentialManager]::Corrupt=$true }
if($Mode -eq 'no-env-reads') {
  New-Item -ItemType Directory -Path (Join-Path $Fixture '.env') | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $Fixture '.env.prod') | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $Fixture '.env.managed-prod') | Out-Null
}
$importArgs=@{Action='import';Environment='prod';RepoRoot=$Fixture;ClaudeKeyOnly=$true}
if($Mode -eq 'dry-run') { $importArgs.DryRun=$true }
if($Mode -eq 'invalid-action') { $importArgs.Action='export' }
if($Mode -eq 'env-source') { $importArgs.FromEnvFile='.env' }
if($Mode -eq 'optional') { $importArgs.IncludeOptional=$true }
if($Mode -eq 'force') { $importArgs.Force=$true }
if($Mode -eq 'legacy') { $importArgs.Remove('ClaudeKeyOnly') }
$failed=$false
$log=''
try { $log=(& $Importer @importArgs *>&1 | Out-String) } catch { $failed=$true; $log += $_.Exception.Message }
if($log.Contains('SYNTHETIC-INPUT-NO-ACTUAL-CREDENTIAL')) { throw 'Synthetic input was exposed' }
[pscustomobject]@{Failed=$failed;Prompts=$global:Prompts;Secure=$global:SecurePrompt;Reads=[SchoologyBot.CredentialManager]::Reads;Targets=@([SchoologyBot.CredentialManager]::Targets);ReadbackFailure=$log.Contains('Credential readback failed');ExistingRefused=$log.Contains('Credential already present');ScopeRefused=$log.Contains('ClaudeKeyOnly requires import')} | ConvertTo-Json -Compress
`;

function run(mode){
  const fixtureBase=path.resolve(tmpdir());
  const root=mkdtempSync(path.join(fixtureBase,'schoology-claude-key-fixture-'));
  try {
    const script=path.join(root,'run.ps1');writeFileSync(script,wrapper);
    const result=spawnSync(runtime.command,['-NoProfile','-NonInteractive','-File',script,'-Mode',mode,'-Importer',importer,'-Fixture',root],{encoding:'utf8',timeout:30000,windowsHide:true});
    assert.equal(result.status,0,`Fixture failed (${mode}): ${result.stderr}`);
    assert.ok(!result.stdout.includes(marker));assert.ok(!result.stderr.includes(marker));
    return JSON.parse(result.stdout.trim());
  } finally {
    assert.equal(path.dirname(path.resolve(root)),fixtureBase);
    assert.ok(path.basename(root).startsWith('schoology-claude-key-fixture-'));
    rmSync(root,{recursive:true,force:true});
  }
}

test('Claude-only native import prompts securely once and checks the exact encrypted target',()=>{
  const r=run('normal');assert.equal(r.Failed,false);assert.equal(r.Prompts,1);assert.equal(r.Secure,true);assert.equal(r.Reads,2);assert.deepEqual(r.Targets,['schoology-bot/prod/ANTHROPIC_API_KEY']);
});
test('Claude-only native import never reads default environment source paths',()=>{
  const r=run('no-env-reads');assert.equal(r.Failed,false);assert.equal(r.Prompts,1);assert.deepEqual(r.Targets,['schoology-bot/prod/ANTHROPIC_API_KEY']);
});
test('Claude-only dry run neither prompts, reads credentials nor writes',()=>{
  const r=run('dry-run');assert.equal(r.Failed,false);assert.equal(r.Prompts,0);assert.equal(r.Reads,0);assert.deepEqual(r.Targets,[]);
});
test('Claude-only mode refuses source files, other actions, additional keys and forced overwrite',()=>{
  for(const mode of ['invalid-action','env-source','optional','force']) {const r=run(mode);assert.equal(r.Failed,true);assert.equal(r.ScopeRefused,true);assert.equal(r.Prompts,0);assert.equal(r.Reads,0);assert.deepEqual(r.Targets,[]);}
});
test('existing and empty Claude credentials are refused without a write',()=>{
  const existing=run('existing');assert.equal(existing.Failed,true);assert.equal(existing.ExistingRefused,true);assert.equal(existing.Prompts,0);assert.deepEqual(existing.Targets,[]);
  const empty=run('empty');assert.equal(empty.Failed,true);assert.equal(empty.Prompts,1);assert.deepEqual(empty.Targets,[]);
});
test('a failed opaque installation readback cannot report success or retry the write',()=>{
  const r=run('bad-readback');assert.equal(r.Failed,true);assert.equal(r.ReadbackFailure,true);assert.equal(r.Prompts,1);assert.equal(r.Targets.length,1);assert.equal(r.Reads,2);
});
test('unselected legacy import retains its existing five required-key prompts',()=>{
  const r=run('legacy');assert.equal(r.Failed,false);assert.equal(r.Prompts,5);assert.equal(r.Secure,true);assert.equal(r.Targets.length,5);assert.equal(r.Reads,0);
});
