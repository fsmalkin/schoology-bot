param(
  [string]$RepoRoot = "",
  [ValidateSet("native", "docker")][string]$RuntimeMode = "native",
  [string]$WslDistro = "Ubuntu-24.04",
  [ValidateSet("local", "sync")][string]$Source = "local",
  [string]$Snapshot = "latest",
  [string]$BackupLocalRoot = "D:\backups\schoology\local",
  [string]$BackupSyncRoot = "D:\backups\schoology\sync",
  [string]$ProdProject = "schoology-prod",
  [string]$BetaProject = "schoology-openclaw-beta",
  [string]$ProdVolumeName = "schoology_agent_db_prod",
  [switch]$SkipStart,
  [switch]$AllowMissingDbSnapshot,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[schoology-restore] " + $message)
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

function Invoke-Docker([string[]]$DockerArgs) {
  $display = "docker " + ($DockerArgs -join " ")
  if ($DryRun) {
    Write-Step ("DRY RUN: " + $display)
    return ""
  }
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

function Invoke-Wsl([string]$Command) {
  $display = "wsl -d $WslDistro -- bash -lc `"$Command`""
  if ($DryRun) {
    Write-Step ("DRY RUN: " + $display)
    return ""
  }
  Write-Step ("Running: " + $display)
  $previous = $ErrorActionPreference
  $output = $null
  $exitCode = 0
  try {
    $ErrorActionPreference = "Continue"
    $output = & wsl -d $WslDistro -- bash -lc $Command 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($exitCode -ne 0) {
    throw "WSL command failed: $Command`n$($output -join "`n")"
  }
  if ($output) {
    $output | Out-Host
  }
  return ($output -join "`n")
}

function Resolve-ArchivePath($source, $snapshotName, $localRoot, $syncRoot) {
  $archiveRoot = if ($source -eq "local") {
    Join-Path $localRoot "archives"
  } else {
    $syncRoot
  }

  if ($snapshotName -eq "latest") {
    $latest = Get-ChildItem -Path $archiveRoot -Filter "schoology-backup-*.zip" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if (-not $latest) {
      throw "No backup archives found in $archiveRoot"
    }
    return $latest.FullName
  }

  if (Test-Path $snapshotName) {
    return (Resolve-Path $snapshotName).Path
  }

  $candidate = Join-Path $archiveRoot $snapshotName
  if (Test-Path $candidate) {
    return (Resolve-Path $candidate).Path
  }
  if (-not $candidate.EndsWith(".zip")) {
    $candidateZip = $candidate + ".zip"
    if (Test-Path $candidateZip) {
      return (Resolve-Path $candidateZip).Path
    }
  }
  throw "Backup archive not found for snapshot '$snapshotName' in $archiveRoot"
}

function Restore-FileIfExists($extractRoot, $repoRoot, $relativePath) {
  $source = Join-Path $extractRoot $relativePath
  if (-not (Test-Path $source)) {
    Write-Step ("Skip missing restore file: " + $relativePath)
    return
  }
  $target = Join-Path $repoRoot $relativePath
  $targetDir = Split-Path -Parent $target
  if ($DryRun) {
    Write-Step ("DRY RUN: restore file " + $relativePath)
    return
  }
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Copy-Item -Path $source -Destination $target -Force
  Write-Step ("Restored file: " + $relativePath)
}

function Restore-DirectoryIfExists($extractRoot, $repoRoot, $relativePath) {
  $source = Join-Path $extractRoot $relativePath
  if (-not (Test-Path $source)) {
    Write-Step ("Skip missing restore directory: " + $relativePath)
    return
  }
  $target = Join-Path $repoRoot $relativePath
  $targetParent = Split-Path -Parent $target
  if ($DryRun) {
    Write-Step ("DRY RUN: restore directory " + $relativePath)
    return
  }
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  if (Test-Path $target) {
    Remove-Item -Path $target -Recurse -Force
  }
  Copy-Item -Path $source -Destination $target -Recurse -Force
  Write-Step ("Restored directory: " + $relativePath)
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path $RepoRoot).Path
Set-Location $RepoRoot

$archivePath = Resolve-ArchivePath -source $Source -snapshotName $Snapshot -localRoot $BackupLocalRoot -syncRoot $BackupSyncRoot
Write-Step ("Selected archive: " + $archivePath)

$extractRoot = Join-Path $env:TEMP ("schoology-restore-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
if ($DryRun) {
  Write-Step ("DRY RUN: expand archive to " + $extractRoot)
} else {
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Expand-Archive -Path $archivePath -DestinationPath $extractRoot -Force
  Write-Step ("Extracted archive to " + $extractRoot)
}

if ($RuntimeMode -eq "native") {
  Invoke-Wsl -Command "sudo systemctl stop schoology.target schoology-beta-cron-sync.timer || true" | Out-Null
} else {
  Invoke-Docker -DockerArgs @("compose", "-f", "docker-compose.yml", "-p", $ProdProject, "down") | Out-Null
  Invoke-Docker -DockerArgs @(
    "compose",
    "--env-file",
    ".env.beta",
    "-f",
    "docker-compose.beta-openclaw.yml",
    "-p",
    $BetaProject,
    "down"
  ) | Out-Null
}

$restoreFiles = @(
  "data\state.json",
  "data\storage.json",
  "data\agent.db",
  "data\beta\state.json",
  "data\beta\storage.json",
  "data\beta\agent.db"
)
foreach ($relative in $restoreFiles) {
  Restore-FileIfExists -extractRoot $extractRoot -repoRoot $RepoRoot -relativePath $relative
}
Restore-DirectoryIfExists -extractRoot $extractRoot -repoRoot $RepoRoot -relativePath "data\openclaw-beta"
Restore-DirectoryIfExists -extractRoot $extractRoot -repoRoot $RepoRoot -relativePath "openclaw_workspace"

$dbSnapshot = Join-Path (Join-Path $extractRoot "db") "agent.db.prod"
if ($DryRun) {
  Write-Step ("DRY RUN: restore prod DB from " + $dbSnapshot)
} else {
  if (Test-Path $dbSnapshot) {
    if ($RuntimeMode -eq "native") {
      $nativeDbTarget = Join-Path $RepoRoot "data\agent.db"
      New-Item -ItemType Directory -Path (Split-Path -Parent $nativeDbTarget) -Force | Out-Null
      Copy-Item -Path $dbSnapshot -Destination $nativeDbTarget -Force
      Write-Step "Restored prod DB into native file data\agent.db."
    } else {
      Invoke-Docker -DockerArgs @(
        "run",
        "--rm",
        "-v",
        "${ProdVolumeName}:/to",
        "-v",
        "$(Split-Path -Parent $dbSnapshot):/from",
        "alpine:3.20",
        "sh",
        "-lc",
        "cp /from/agent.db.prod /to/agent.db"
      ) | Out-Null
      Write-Step "Restored prod DB into Docker volume."
    }
  } elseif ($AllowMissingDbSnapshot) {
    Write-Step "WARNING: archive has no db/agent.db.prod; skipping DB restore due to -AllowMissingDbSnapshot."
  } else {
    throw "Archive missing db/agent.db.prod. Use -AllowMissingDbSnapshot to continue without DB restore."
  }
}

if (-not $SkipStart) {
  $startScript = Join-Path $RepoRoot "scripts\start_schoology_stacks.ps1"
  if ($DryRun) {
    Write-Step ("DRY RUN: powershell -ExecutionPolicy Bypass -File `"$startScript`" -RepoRoot `"$RepoRoot`" -RuntimeMode $RuntimeMode -NoBuild -WslDistro $WslDistro")
  } else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $startScript -RepoRoot $RepoRoot -RuntimeMode $RuntimeMode -NoBuild -WslDistro $WslDistro -ProdProject $ProdProject -BetaProject $BetaProject -SkipPortCheck
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to restart stacks after restore."
    }
  }
}

if (-not $DryRun -and -not $SkipStart) {
  try {
    $prodHealth = Invoke-RestMethod "http://127.0.0.1:8787/api/health"
    Write-Step ("Prod dashboard health ok: " + ($prodHealth | ConvertTo-Json -Compress))
  } catch {
    Write-Step "WARNING: failed to read prod dashboard health endpoint."
  }
  try {
    $betaHealth = Invoke-RestMethod "http://127.0.0.1:8788/api/health"
    Write-Step ("Beta dashboard health ok: " + ($betaHealth | ConvertTo-Json -Compress))
  } catch {
    Write-Step "WARNING: failed to read beta dashboard health endpoint."
  }
}

if ($DryRun) {
  Write-Step ("DRY RUN: remove temp dir " + $extractRoot)
} else {
  if (Test-Path $extractRoot) {
    Remove-Item -Path $extractRoot -Recurse -Force
  }
}

Write-Step "Done."
