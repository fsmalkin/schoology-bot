param(
  [string]$Branch = "",
  [switch]$DryRun,
  [switch]$SkipTests,
  [switch]$RunLiveTests
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

function Write-Step($message) {
  Write-Host ("[auto-update] " + $message)
}

function Run-Command($command) {
  if ($DryRun) {
    Write-Step ("DRY RUN: " + $command)
    return
  }
  Write-Step ("Running: " + $command)
  iex $command
}

Write-Step "Repo: $repoRoot"

$status = git status --porcelain
if ($status) {
  throw "Working tree is not clean. Commit or stash changes before auto-update."
}

if (-not $Branch -or $Branch.Trim().Length -eq 0) {
  $Branch = git rev-parse --abbrev-ref HEAD
}

Write-Step "Target branch: $Branch"
Run-Command "git fetch"
Run-Command "git checkout $Branch"
Run-Command "git pull --ff-only"
if (-not $SkipTests) {
  if (-not $RunLiveTests) {
    $env:SKIP_LIVE_TESTS = "1"
  }
  Run-Command "npm test"
}
Run-Command "docker compose up -d --build"
Run-Command "docker compose ps"

Write-Step "Done."
