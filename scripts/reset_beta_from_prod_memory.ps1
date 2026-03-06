param(
  [string]$ProjectRoot = "",
  [string]$BetaComposeFile = "docker-compose.beta-openclaw.yml",
  [string]$BetaComposeEnvFile = ".env.beta",
  [string]$BetaComposeProject = "schoology-openclaw-beta",
  [string]$ProdVolumeName = "schoology_agent_db_prod",
  [string]$BetaDataDir = "data\beta",
  [switch]$SkipRestart,
  [switch]$SkipBetaDashboard
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $false

function Write-Step([string]$Message) {
  Write-Host ("[beta-reset] " + $Message)
}

function Ensure-DockerPath() {
  $current = @($env:PATH -split ";")
  $candidates = @(
    "C:\Program Files\Docker\Docker\resources\bin",
    "C:\ProgramData\DockerDesktop\version-bin",
    "C:\Program Files\Docker\Docker"
  )
  foreach ($dir in $candidates) {
    if (-not (Test-Path $dir)) {
      continue
    }
    if ($current -contains $dir) {
      continue
    }
    $env:PATH = $env:PATH + ";" + $dir
    $current += $dir
  }
}

function Get-DockerCommandPath() {
  Ensure-DockerPath
  $cmd = Get-Command "docker" -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    return $cmd.Source
  }
  $fallbacks = @(
    "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    "C:\ProgramData\DockerDesktop\version-bin\docker.exe"
  )
  foreach ($path in $fallbacks) {
    if (Test-Path $path) {
      return $path
    }
  }
  throw "docker executable was not found in PATH or standard install locations."
}

function Invoke-Docker {
  param([string[]]$DockerArgs)

  $display = "docker " + ($DockerArgs -join " ")
  Write-Step ("Running: " + $display)

  $dockerExe = Get-DockerCommandPath
  $previous = $ErrorActionPreference
  $output = $null
  $exitCode = 0
  try {
    $ErrorActionPreference = "Continue"
    $output = & $dockerExe @DockerArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($exitCode -ne 0) {
    throw "Docker command failed: $display`n$($output -join "`n")"
  }
  if ($output) {
    $output | Out-Host
  }
  return ($output -join "`n")
}

function Invoke-BetaCompose {
  param([string[]]$ComposeArgs)
  $dockerArgs = @(
    "compose",
    "--env-file",
    $BetaComposeEnvFile,
    "-f",
    $BetaComposeFile,
    "-p",
    $BetaComposeProject
  ) + $ComposeArgs
  return Invoke-Docker -DockerArgs $dockerArgs
}

function Backup-DbSnapshot {
  param(
    [string]$SourceMountSpec,
    [string]$SourceRelativePath,
    [string]$ArtifactFileName,
    [string]$HelperImage,
    [string]$ArtifactDirPath
  )

  Invoke-Docker -DockerArgs @(
    "run",
    "--rm",
    "-v",
    "${SourceMountSpec}:/from",
    "-v",
    "${ArtifactDirPath}:/work",
    $HelperImage,
    "python3",
    "/work/sqlite_backup.py",
    "/from/$SourceRelativePath",
    "/work/$ArtifactFileName"
  ) | Out-Null
}

function Restart-BetaStack {
  param(
    [string]$ProjectRootPath,
    [switch]$SkipDashboard
  )

  $startScript = Join-Path $ProjectRootPath "scripts\start_schoology_stacks.ps1"
  if (-not (Test-Path $startScript)) {
    throw "Missing required start script: $startScript"
  }

  $args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $startScript,
    "-RepoRoot",
    $ProjectRootPath,
    "-RuntimeMode",
    "docker",
    "-SkipProd",
    "-NoBuild",
    "-SkipPortCheck"
  )
  if ($SkipDashboard) {
    $args += "-SkipBetaDashboard"
  }

  Write-Step ("Restarting beta stack via start_schoology_stacks.ps1.")
  & powershell @args
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to restart beta stack."
  }
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot

if (-not (Test-Path $BetaComposeFile)) {
  throw "Missing beta compose file: $BetaComposeFile"
}
if (-not (Test-Path $BetaComposeEnvFile)) {
  throw "Missing beta env file: $BetaComposeEnvFile"
}

$betaDataDirPath = Join-Path $ProjectRoot $BetaDataDir
$dataDir = Join-Path $ProjectRoot "data"
$stateSrc = Join-Path $dataDir "state.json"
$stateDst = Join-Path $betaDataDirPath "state.json"
$storageSrc = Join-Path $dataDir "storage.json"
$storageDst = Join-Path $betaDataDirPath "storage.json"

New-Item -ItemType Directory -Path $betaDataDirPath -Force | Out-Null

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

$backupScriptPath = Join-Path $artifactDir "sqlite_backup.py"
@'
import sqlite3
import sys
from pathlib import Path

source_path, target_path = sys.argv[1:3]

source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
target_parent = Path(target_path).parent
target_parent.mkdir(parents=True, exist_ok=True)
target = sqlite3.connect(target_path)
with target:
  source.backup(target)
target.close()
source.close()
'@ | Set-Content -Path $backupScriptPath -Encoding UTF8

$reportScriptPath = Join-Path $artifactDir "build-reset-report.py"
@'
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

prod_snapshot_path, prod_live_path, beta_path, report_json_path, report_md_path = sys.argv[1:6]

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

prod = read_metrics(prod_snapshot_path)
beta = read_metrics(beta_path)
prod_live = read_metrics(prod_live_path) if Path(prod_live_path).exists() else None

checks = {
  "assignmentsCountMatch": prod["assignments"] == beta["assignments"],
  "tasksCountMatch": prod["tasks"] == beta["tasks"],
  "pendingTasksMatch": prod["pendingTasks"] == beta["pendingTasks"],
  "latestAssignmentSeenAtMatch": str(prod["latestAssignmentSeenAt"] or "") == str(beta["latestAssignmentSeenAt"] or ""),
  "latestTaskCreatedAtMatch": str(prod["latestTaskCreatedAt"] or "") == str(beta["latestTaskCreatedAt"] or ""),
  "latestTaskRemindAtMatch": str(prod["latestTaskRemindAt"] or "") == str(beta["latestTaskRemindAt"] or ""),
}

live_checks = None
if prod_live is not None:
  live_checks = {
    "assignmentsCountMatch": prod_live["assignments"] == beta["assignments"],
    "tasksCountMatch": prod_live["tasks"] == beta["tasks"],
    "pendingTasksMatch": prod_live["pendingTasks"] == beta["pendingTasks"],
    "latestAssignmentSeenAtMatch": str(prod_live["latestAssignmentSeenAt"] or "") == str(beta["latestAssignmentSeenAt"] or ""),
    "latestTaskCreatedAtMatch": str(prod_live["latestTaskCreatedAt"] or "") == str(beta["latestTaskCreatedAt"] or ""),
    "latestTaskRemindAtMatch": str(prod_live["latestTaskRemindAt"] or "") == str(beta["latestTaskRemindAt"] or ""),
  }

report = {
  "generatedAt": datetime.now(timezone.utc).isoformat(),
  "prod": prod,
  "prodLive": prod_live,
  "beta": beta,
  "checks": checks,
  "liveChecks": live_checks,
  "ok": all(checks.values()),
}

Path(report_json_path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

lines = [
  "# Beta Reset Report",
  "",
  f"Generated at: {report['generatedAt']}",
  "",
  "## Source Snapshot Check Results",
  f"- assignmentsCountMatch: {checks['assignmentsCountMatch']}",
  f"- tasksCountMatch: {checks['tasksCountMatch']}",
  f"- pendingTasksMatch: {checks['pendingTasksMatch']}",
  f"- latestAssignmentSeenAtMatch: {checks['latestAssignmentSeenAtMatch']}",
  f"- latestTaskCreatedAtMatch: {checks['latestTaskCreatedAtMatch']}",
  f"- latestTaskRemindAtMatch: {checks['latestTaskRemindAtMatch']}",
  "",
  "## Prod Snapshot Metrics",
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
]

if prod_live is not None:
  live_matches = all(live_checks.values())
  lines.extend([
    "",
    "## Live Prod Metrics",
    f"- assignments: {prod_live['assignments']}",
    f"- tasks: {prod_live['tasks']}",
    f"- pendingTasks: {prod_live['pendingTasks']}",
    f"- assignmentReminderTasks: {prod_live['assignmentReminderTasks']}",
    f"- latestAssignmentSeenAt: {prod_live['latestAssignmentSeenAt'] or 'n/a'}",
    f"- latestTaskCreatedAt: {prod_live['latestTaskCreatedAt'] or 'n/a'}",
    f"- latestTaskRemindAt: {prod_live['latestTaskRemindAt'] or 'n/a'}",
    "",
    f"Live prod still matches beta: {live_matches}",
  ])

Path(report_md_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
'@ | Set-Content -Path $reportScriptPath -Encoding UTF8

Write-Step "Snapshotting prod DB from the live prod volume."
Backup-DbSnapshot -SourceMountSpec $ProdVolumeName -SourceRelativePath "agent.db" -ArtifactFileName "agent.db.prod.snapshot" -HelperImage $helperImage -ArtifactDirPath $artifactDir

Write-Step "Stopping active beta stack before replacing beta data."
Invoke-BetaCompose -ComposeArgs @("down") | Out-Null

$betaDbPath = Join-Path $betaDataDirPath "agent.db"
if (Test-Path $betaDbPath) {
  Write-Step "Capturing beta pre-reset snapshot."
  Backup-DbSnapshot -SourceMountSpec $betaDataDirPath -SourceRelativePath "agent.db" -ArtifactFileName "agent.db.beta.pre_reset" -HelperImage $helperImage -ArtifactDirPath $artifactDir
} else {
  Write-Step "Beta DB was not present; skipping pre-reset snapshot."
}

foreach ($suffix in @("", "-wal", "-shm")) {
  $candidate = $betaDbPath + $suffix
  if (Test-Path $candidate) {
    Remove-Item -Path $candidate -Force
  }
}
Copy-Item -Path $prodSnapshot -Destination $betaDbPath -Force
Write-Step ("Wrote prod DB snapshot into beta DB path: " + $betaDbPath)

if (Test-Path $stateSrc) {
  Copy-Item -Path $stateSrc -Destination $stateDst -Force
  Write-Step "Copied prod state.json into beta."
} else {
  Write-Step "Prod state.json missing; skipped beta state copy."
}

if (Test-Path $storageSrc) {
  Copy-Item -Path $storageSrc -Destination $storageDst -Force
  Write-Step "Copied prod storage.json into beta."
} else {
  Write-Step "Prod storage.json missing; skipped beta storage copy."
}

if (-not $SkipRestart) {
  Restart-BetaStack -ProjectRootPath $ProjectRoot -SkipDashboard:$SkipBetaDashboard
} else {
  Write-Step "SkipRestart requested; beta stack remains stopped after reset."
}

Write-Step "Capturing beta post-reset snapshot."
Backup-DbSnapshot -SourceMountSpec $betaDataDirPath -SourceRelativePath "agent.db" -ArtifactFileName "agent.db.beta.post" -HelperImage $helperImage -ArtifactDirPath $artifactDir

Write-Step "Capturing live prod post-reset snapshot."
Backup-DbSnapshot -SourceMountSpec $ProdVolumeName -SourceRelativePath "agent.db" -ArtifactFileName "agent.db.prod.post" -HelperImage $helperImage -ArtifactDirPath $artifactDir

Invoke-Docker -DockerArgs @(
  "run",
  "--rm",
  "-v",
  "${artifactDir}:/work",
  "-w",
  "/work",
  $helperImage,
  "python3",
  "build-reset-report.py",
  "agent.db.prod.snapshot",
  "agent.db.prod.post",
  "agent.db.beta.post",
  "reset-report.json",
  "reset-report.md"
) | Out-Null

Write-Host ""
Write-Host "Beta memory reset completed."
Write-Host "Artifacts:"
Write-Host " - $prodSnapshot"
if (Test-Path $betaPreSnapshot) {
  Write-Host " - $betaPreSnapshot"
}
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
