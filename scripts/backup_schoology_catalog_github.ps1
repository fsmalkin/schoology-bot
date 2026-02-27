param(
  [string]$StatusFile = "D:\backups\schoology\local\backup-status\last-success.json",
  [string]$RestoreDrillStatusFile = "D:\backups\schoology\local\backup-status\restore-drill.json",
  [string]$CatalogRepoRoot = "D:\backups\schoology\catalog-repo",
  [string]$GhRepoName = "schoology-backup-catalog",
  [string]$GhOwner = "",
  [string]$Branch = "main",
  [switch]$AutoCreateRepo,
  [switch]$SkipPush,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[schoology-catalog] " + $message)
}

function Invoke-Cmd([string]$Program, [string[]]$CmdArgs) {
  $display = $Program + " " + ($CmdArgs -join " ")
  if ($DryRun) {
    Write-Step ("DRY RUN: " + $display)
    return @("", 0)
  }
  $previous = $ErrorActionPreference
  $output = $null
  $exitCode = 0
  try {
    $ErrorActionPreference = "Continue"
    $output = & $Program @CmdArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  $outputText = @()
  if ($output) {
    $outputText = @($output | ForEach-Object { [string]$_ })
    $outputText | Out-Host
  }
  return @([string]($outputText -join "`n"), [int]$exitCode)
}

if (-not (Test-Path $StatusFile)) {
  throw "Missing status file: $StatusFile"
}

try {
  $status = Get-Content -Path $StatusFile -Raw | ConvertFrom-Json
} catch {
  throw "Status file is not valid JSON: $StatusFile"
}

$finishedAt = [string]$status.finishedAt
if ([string]::IsNullOrWhiteSpace($finishedAt)) {
  throw "Status file missing finishedAt."
}

$archivePath = [string]$status.archiveLocalPath
if ([string]::IsNullOrWhiteSpace($archivePath) -or -not (Test-Path $archivePath)) {
  throw "Status file archiveLocalPath is missing or not found: $archivePath"
}
$manifestPath = [string]$status.manifestPath

$archiveHash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestHash = ""
if (-not [string]::IsNullOrWhiteSpace($manifestPath) -and (Test-Path $manifestPath)) {
  $manifestHash = (Get-FileHash -Path $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$restoreDrillSummary = [ordered]@{
  available = $false
  generatedAt = ""
  ok = $false
  archiveName = ""
}
if (Test-Path $RestoreDrillStatusFile) {
  try {
    $restoreDrill = Get-Content -Path $RestoreDrillStatusFile -Raw | ConvertFrom-Json
    $restoreDrillSummary.available = $true
    $restoreDrillSummary.generatedAt = [string]$restoreDrill.generatedAt
    $restoreDrillSummary.ok = [bool]$restoreDrill.ok
    $restoreDrillSummary.archiveName = [string]$restoreDrill.archiveName
  } catch {
    Write-Step "WARNING: restore drill status file is invalid JSON; omitting restoreDrill metadata."
  }
}

$archiveName = Split-Path -Leaf $archivePath
$entryDate = [datetimeoffset]::Parse($finishedAt)
$entryDir = Join-Path $CatalogRepoRoot ("entries\" + $entryDate.ToString("yyyy") + "\" + $entryDate.ToString("MM"))
$entryPath = Join-Path $entryDir ($archiveName -replace "\.zip$", ".json")
$latestPath = Join-Path $CatalogRepoRoot "latest.json"

if ($DryRun) {
  Write-Step ("DRY RUN: ensure repo dir " + $CatalogRepoRoot)
} else {
  New-Item -ItemType Directory -Path $CatalogRepoRoot -Force | Out-Null
}

$isGitRepo = $false
if (Test-Path (Join-Path $CatalogRepoRoot ".git")) {
  $isGitRepo = $true
}

if (-not $isGitRepo) {
  $gitInit = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "init", "-b", $Branch)
  if ($gitInit[1] -ne 0) {
    Write-Step "git init -b not supported; falling back to legacy init flow."
    $legacyInit = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "init")
    if ($legacyInit[1] -ne 0) {
      throw "Failed to initialize git repo at $CatalogRepoRoot"
    }
    $branchInit = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "checkout", "-B", $Branch)
    if ($branchInit[1] -ne 0) {
      throw "Failed to set default branch to $Branch in $CatalogRepoRoot"
    }
  }
  $isGitRepo = $true
}

$branchResult = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "rev-parse", "--abbrev-ref", "HEAD")
if ($branchResult[1] -ne 0) {
  throw "Failed to determine current branch in $CatalogRepoRoot"
}
$currentBranch = ([string]$branchResult[0]).Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch) -or $currentBranch -eq "HEAD") {
  $checkoutHead = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "checkout", "-B", $Branch)
  if ($checkoutHead[1] -ne 0) {
    throw "Failed to create and checkout branch $Branch in $CatalogRepoRoot"
  }
} elseif ($currentBranch -ne $Branch) {
  $checkoutBranch = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "checkout", "-B", $Branch)
  if ($checkoutBranch[1] -ne 0) {
    throw "Failed to switch branch from $currentBranch to $Branch in $CatalogRepoRoot"
  }
  Write-Step ("Switched catalog branch to " + $Branch)
}

$nameCheck = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "config", "--get", "user.name")
if ($nameCheck[1] -ne 0 -or [string]::IsNullOrWhiteSpace([string]$nameCheck[0])) {
  $setName = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "config", "user.name", "Schoology Backup Catalog")
  if ($setName[1] -ne 0) {
    throw "Failed to set git user.name in $CatalogRepoRoot"
  }
}
$emailCheck = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "config", "--get", "user.email")
if ($emailCheck[1] -ne 0 -or [string]::IsNullOrWhiteSpace([string]$emailCheck[0])) {
  $setEmail = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "config", "user.email", "schoology-backup-catalog@local.invalid")
  if ($setEmail[1] -ne 0) {
    throw "Failed to set git user.email in $CatalogRepoRoot"
  }
}

$remoteCheck = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "remote", "get-url", "origin")
$hasOrigin = ($remoteCheck[1] -eq 0)

if (-not $hasOrigin -and $AutoCreateRepo) {
  $ghCmd = Get-Command "gh" -ErrorAction SilentlyContinue
  if (-not $ghCmd) {
    Write-Step "WARNING: gh is not installed; cannot auto-create GitHub repo."
  } else {
    $repoSlug = if ([string]::IsNullOrWhiteSpace($GhOwner)) { $GhRepoName } else { "$GhOwner/$GhRepoName" }
    $ghArgs = @(
      "repo",
      "create",
      $repoSlug,
      "--private",
      "--source",
      $CatalogRepoRoot,
      "--remote",
      "origin"
    )
    $ghResult = Invoke-Cmd -Program "gh" -CmdArgs $ghArgs
    if ($ghResult[1] -ne 0) {
      Write-Step "WARNING: failed to auto-create GitHub repo; continuing with local catalog only."
    } else {
      $hasOrigin = $true
    }
  }
}

$entry = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  backupFinishedAt = $finishedAt
  archiveName = $archiveName
  archiveBytes = [int64](Get-Item $archivePath).Length
  archiveSha256 = $archiveHash
  manifestSha256 = $manifestHash
  runtimeMode = [string]$status.runtimeMode
  dbExported = [bool]$status.dbExported
  dbSource = [string]$status.dbSource
  restoreDrill = $restoreDrillSummary
}

if ($DryRun) {
  Write-Step ("DRY RUN: write entry " + $entryPath)
  Write-Step ("DRY RUN: write latest marker " + $latestPath)
} else {
  New-Item -ItemType Directory -Path $entryDir -Force | Out-Null
  ($entry | ConvertTo-Json -Depth 6) | Set-Content -Path $entryPath -Encoding UTF8
  ($entry | ConvertTo-Json -Depth 6) | Set-Content -Path $latestPath -Encoding UTF8
}

$addResult = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "add", "entries", "latest.json")
if ($addResult[1] -ne 0) {
  throw "git add failed in $CatalogRepoRoot"
}

$statusResult = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "status", "--porcelain")
if ($statusResult[1] -ne 0) {
  throw "git status failed in $CatalogRepoRoot"
}
$hasChanges = -not [string]::IsNullOrWhiteSpace([string]$statusResult[0])
if (-not $hasChanges) {
  Write-Step "No catalog changes to commit."
  Write-Step "Done."
  exit 0
}

$commitMsg = "backup-catalog: " + $entryDate.ToString("yyyy-MM-ddTHH:mm:sszzz")
$commitResult = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "commit", "-m", $commitMsg)
if ($commitResult[1] -ne 0) {
  throw "git commit failed in $CatalogRepoRoot"
}

if ($SkipPush) {
  Write-Step "SkipPush enabled; leaving commit local."
  Write-Step "Done."
  exit 0
}

if (-not $hasOrigin) {
  Write-Step "WARNING: no git origin configured for catalog repo; leaving commit local."
  Write-Step "Done."
  exit 0
}

$pushResult = Invoke-Cmd -Program "git" -CmdArgs @("-C", $CatalogRepoRoot, "push", "-u", "origin", $Branch)
if ($pushResult[1] -ne 0) {
  throw "git push failed for catalog repo."
}

Write-Step "Done."
