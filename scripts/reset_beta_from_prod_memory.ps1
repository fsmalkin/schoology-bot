param(
  [string]$ProjectRoot = "",
  [string]$ComposeFile = "docker-compose.beta.yml",
  [string]$ComposeEnvFile = ".env.beta",
  [string]$ComposeProject = "schoology-beta",
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $false

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Invoke-Docker {
  param([string[]]$DockerArgs)
  Write-Host ("+ docker " + ($DockerArgs -join " "))
  $previous = $ErrorActionPreference
  $output = $null
  $exitCode = 0
  try {
    $ErrorActionPreference = "Continue"
    $output = & docker @DockerArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($exitCode -ne 0) {
    throw "Docker command failed: $($output -join "`n")"
  }
  return ($output -join "`n")
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  $composeArgs = @("compose", "--env-file", $ComposeEnvFile, "-f", $ComposeFile, "-p", $ComposeProject) + $ComposeArgs
  Write-Host ("+ docker " + ($composeArgs -join " "))
  $previous = $ErrorActionPreference
  $output = $null
  $exitCode = 0
  try {
    $ErrorActionPreference = "Continue"
    $output = & docker @composeArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($exitCode -ne 0) {
    throw "Docker compose command failed: $($output -join "`n")"
  }
  return ($output -join "`n")
}

Set-Location $ProjectRoot

if (-not (Test-Path $ComposeFile)) {
  throw "Missing compose file: $ComposeFile"
}
if (-not (Test-Path $ComposeEnvFile)) {
  throw "Missing env file: $ComposeEnvFile"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifactDir = Join-Path $ProjectRoot ("artifacts\beta-reset\" + $timestamp)
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

$prodSnapshot = Join-Path $artifactDir "agent.db.prod.snapshot"
$betaPreSnapshot = Join-Path $artifactDir "agent.db.beta.pre_reset"
$prodPostSnapshot = Join-Path $artifactDir "agent.db.prod.post"
$betaPostSnapshot = Join-Path $artifactDir "agent.db.beta.post"
$reportJsonPath = Join-Path $artifactDir "reset-report.json"
$reportMdPath = Join-Path $artifactDir "reset-report.md"
$helperImage = "schoology-app:latest"

Invoke-Docker @(
  "run",
  "--rm",
  "-v", "schoology_agent_db_prod:/from",
  "-v", "${artifactDir}:/out",
  $helperImage,
  "sh",
  "-lc",
  "test -f /from/agent.db && cp /from/agent.db /out/agent.db.prod.snapshot"
) | Out-Null

Invoke-Docker @(
  "run",
  "--rm",
  "-v", "schoology_agent_db_beta:/from",
  "-v", "${artifactDir}:/out",
  $helperImage,
  "sh",
  "-lc",
  "if [ -f /from/agent.db ]; then cp /from/agent.db /out/agent.db.beta.pre_reset; fi"
) | Out-Null

Invoke-Docker @(
  "run",
  "--rm",
  "-v", "schoology_agent_db_prod:/from",
  "-v", "schoology_agent_db_beta:/to",
  $helperImage,
  "sh",
  "-lc",
  "cp /from/agent.db /to/agent.db"
) | Out-Null

$dataDir = Join-Path $ProjectRoot "data"
$betaDataDir = Join-Path $dataDir "beta"
New-Item -ItemType Directory -Path $betaDataDir -Force | Out-Null

$stateSrc = Join-Path $dataDir "state.json"
$stateDst = Join-Path $betaDataDir "state.json"
if (Test-Path $stateSrc) {
  Copy-Item -Path $stateSrc -Destination $stateDst -Force
}

$storageSrc = Join-Path $dataDir "storage.json"
$storageDst = Join-Path $betaDataDir "storage.json"
if (Test-Path $storageSrc) {
  Copy-Item -Path $storageSrc -Destination $storageDst -Force
}

if (-not $SkipRestart) {
  Invoke-Compose @("up", "-d", "--build") | Out-Null
}

Invoke-Docker @(
  "run",
  "--rm",
  "-v", "schoology_agent_db_prod:/from",
  "-v", "${artifactDir}:/out",
  $helperImage,
  "sh",
  "-lc",
  "cp /from/agent.db /out/agent.db.prod.post"
) | Out-Null

Invoke-Docker @(
  "run",
  "--rm",
  "-v", "schoology_agent_db_beta:/from",
  "-v", "${artifactDir}:/out",
  $helperImage,
  "sh",
  "-lc",
  "cp /from/agent.db /out/agent.db.beta.post"
) | Out-Null

$reportScriptPath = Join-Path $artifactDir "build-reset-report.py"
@'
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

prod_path, beta_path, report_json_path, report_md_path = sys.argv[1:5]

def table_exists(cur, table_name):
  row = cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    (table_name,),
  ).fetchone()
  return bool(row)

def scalar(cur, query):
  row = cur.execute(query).fetchone()
  if row is None:
    return None
  return row[0]

def read_metrics(db_path):
  conn = sqlite3.connect(db_path)
  cur = conn.cursor()
  has_assignments = table_exists(cur, "assignments")
  has_tasks = table_exists(cur, "tasks")
  has_chat_state = table_exists(cur, "chat_state")
  has_pending_actions = table_exists(cur, "pending_actions")
  metrics = {
    "assignments": int(scalar(cur, "SELECT COUNT(*) FROM assignments") or 0) if has_assignments else 0,
    "tasks": int(scalar(cur, "SELECT COUNT(*) FROM tasks") or 0) if has_tasks else 0,
    "pendingTasks": int(scalar(cur, "SELECT COUNT(*) FROM tasks WHERE status='pending'") or 0) if has_tasks else 0,
    "assignmentReminderTasks": int(scalar(cur, "SELECT COUNT(*) FROM tasks WHERE kind='assignment'") or 0) if has_tasks else 0,
    "chatState": int(scalar(cur, "SELECT COUNT(*) FROM chat_state") or 0) if has_chat_state else 0,
    "pendingActions": int(scalar(cur, "SELECT COUNT(*) FROM pending_actions") or 0) if has_pending_actions else 0,
    "latestAssignmentSeenAt": scalar(cur, "SELECT MAX(last_seen_at) FROM assignments") if has_assignments else None,
    "latestTaskCreatedAt": scalar(cur, "SELECT MAX(created_at) FROM tasks") if has_tasks else None,
    "latestTaskRemindAt": scalar(cur, "SELECT MAX(remind_at) FROM tasks") if has_tasks else None,
  }
  conn.close()
  return metrics

prod = read_metrics(prod_path)
beta = read_metrics(beta_path)

checks = {
  "assignmentsCountMatch": prod["assignments"] == beta["assignments"],
  "tasksCountMatch": prod["tasks"] == beta["tasks"],
  "pendingTasksMatch": prod["pendingTasks"] == beta["pendingTasks"],
  "latestAssignmentSeenAtMatch": str(prod["latestAssignmentSeenAt"] or "") == str(beta["latestAssignmentSeenAt"] or ""),
  "latestTaskCreatedAtMatch": str(prod["latestTaskCreatedAt"] or "") == str(beta["latestTaskCreatedAt"] or ""),
  "latestTaskRemindAtMatch": str(prod["latestTaskRemindAt"] or "") == str(beta["latestTaskRemindAt"] or ""),
}

report = {
  "generatedAt": datetime.now(timezone.utc).isoformat(),
  "prod": prod,
  "beta": beta,
  "checks": checks,
  "ok": all(checks.values()),
}

Path(report_json_path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

lines = [
  "# Beta Reset Report",
  "",
  f"Generated at: {report['generatedAt']}",
  "",
  "## Check Results",
  f"- assignmentsCountMatch: {checks['assignmentsCountMatch']}",
  f"- tasksCountMatch: {checks['tasksCountMatch']}",
  f"- pendingTasksMatch: {checks['pendingTasksMatch']}",
  f"- latestAssignmentSeenAtMatch: {checks['latestAssignmentSeenAtMatch']}",
  f"- latestTaskCreatedAtMatch: {checks['latestTaskCreatedAtMatch']}",
  f"- latestTaskRemindAtMatch: {checks['latestTaskRemindAtMatch']}",
  "",
  "## Prod Metrics",
  f"- assignments: {prod['assignments']}",
  f"- tasks: {prod['tasks']}",
  f"- pendingTasks: {prod['pendingTasks']}",
  f"- assignmentReminderTasks: {prod['assignmentReminderTasks']}",
  f"- latestAssignmentSeenAt: {prod['latestAssignmentSeenAt'] or 'n/a'}",
  f"- latestTaskCreatedAt: {prod['latestTaskCreatedAt'] or 'n/a'}",
  f"- latestTaskRemindAt: {prod['latestTaskRemindAt'] or 'n/a'}",
  "",
  "## Beta Metrics",
  f"- assignments: {beta['assignments']}",
  f"- tasks: {beta['tasks']}",
  f"- pendingTasks: {beta['pendingTasks']}",
  f"- assignmentReminderTasks: {beta['assignmentReminderTasks']}",
  f"- latestAssignmentSeenAt: {beta['latestAssignmentSeenAt'] or 'n/a'}",
  f"- latestTaskCreatedAt: {beta['latestTaskCreatedAt'] or 'n/a'}",
  f"- latestTaskRemindAt: {beta['latestTaskRemindAt'] or 'n/a'}",
  "",
  f"Overall: {'PASS' if report['ok'] else 'FAIL'}",
  "",
]
Path(report_md_path).write_text("\n".join(lines), encoding="utf-8")
'@ | Set-Content -Path $reportScriptPath -Encoding UTF8

Invoke-Docker @(
  "run",
  "--rm",
  "-v", "${artifactDir}:/work",
  "-w", "/work",
  $helperImage,
  "python3",
  "build-reset-report.py",
  "agent.db.prod.post",
  "agent.db.beta.post",
  "reset-report.json",
  "reset-report.md"
) | Out-Null

Write-Host ""
Write-Host "Beta memory reset completed."
Write-Host "Artifacts:"
Write-Host " - $prodSnapshot"
Write-Host " - $betaPreSnapshot"
Write-Host " - $prodPostSnapshot"
Write-Host " - $betaPostSnapshot"
Write-Host " - $reportJsonPath"
Write-Host " - $reportMdPath"
if (Test-Path $stateDst) {
  Write-Host " - $stateDst"
}
if (Test-Path $storageDst) {
  Write-Host " - $storageDst"
}
