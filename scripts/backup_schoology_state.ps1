param(
  [string]$RepoRoot = "",
  [ValidateSet("docker")][string]$RuntimeMode = "docker",
  [string]$BackupLocalRoot = "D:\backups\schoology\local",
  [string]$BackupSyncRoot = "D:\backups\schoology\sync",
  [string]$ProdVolumeName = "schoology_agent_db_prod",
  [string]$HelperImage = "schoology-app:latest",
  [int]$RetentionDays = 30,
  [switch]$SkipSyncCopy,
  [switch]$AllowMissingDbSource,
  [switch]$AllowMissingDbVolume,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[schoology-backup] " + $message)
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

function Ensure-Directory($path) {
  if ($DryRun) {
    Write-Step ("DRY RUN: mkdir -p " + $path)
    return
  }
  New-Item -ItemType Directory -Path $path -Force | Out-Null
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

function Copy-FileIfExists($repoRoot, $snapshotRoot, $relativePath) {
  $source = Join-Path $repoRoot $relativePath
  if (-not (Test-Path $source)) {
    Write-Step ("Skip missing file: " + $relativePath)
    return $false
  }
  $target = Join-Path $snapshotRoot $relativePath
  $targetDir = Split-Path -Parent $target
  Ensure-Directory $targetDir
  if ($DryRun) {
    Write-Step ("DRY RUN: copy file " + $relativePath)
    return $true
  }
  Copy-Item -Path $source -Destination $target -Force
  Write-Step ("Copied file: " + $relativePath)
  return $true
}

function Copy-DirectoryIfExists($repoRoot, $snapshotRoot, $relativePath) {
  $source = Join-Path $repoRoot $relativePath
  if (-not (Test-Path $source)) {
    Write-Step ("Skip missing directory: " + $relativePath)
    return $false
  }
  $target = Join-Path $snapshotRoot $relativePath
  $targetDir = Split-Path -Parent $target
  Ensure-Directory $targetDir
  if ($DryRun) {
    Write-Step ("DRY RUN: copy directory " + $relativePath)
    return $true
  }
  Copy-Item -Path $source -Destination $target -Recurse -Force
  Write-Step ("Copied directory: " + $relativePath)
  return $true
}

function Copy-SqliteBundleIfExists($sourceMainPath, $targetMainPath) {
  if (-not (Test-Path $sourceMainPath)) {
    return $false
  }

  $artifacts = @(
    [pscustomobject]@{ Source = $sourceMainPath; Target = $targetMainPath; Label = "main" },
    [pscustomobject]@{ Source = ($sourceMainPath + "-wal"); Target = ($targetMainPath + "-wal"); Label = "wal" },
    [pscustomobject]@{ Source = ($sourceMainPath + "-shm"); Target = ($targetMainPath + "-shm"); Label = "shm" }
  )

  foreach ($artifact in $artifacts) {
    if (-not (Test-Path $artifact.Source)) {
      continue
    }
    Ensure-Directory (Split-Path -Parent $artifact.Target)
    if ($DryRun) {
      Write-Step ("DRY RUN: copy sqlite " + $artifact.Label + " " + $artifact.Source + " -> " + $artifact.Target)
      continue
    }
    Copy-Item -Path $artifact.Source -Destination $artifact.Target -Force
    Write-Step ("Copied sqlite " + $artifact.Label + " snapshot: " + $artifact.Target)
  }

  return $true
}

function Warn-IfSuspiciousSqliteSnapshot($mainPath) {
  if (-not (Test-Path $mainPath)) {
    return
  }
  $mainBytes = (Get-Item $mainPath).Length
  $walPath = $mainPath + "-wal"
  $walBytes = if (Test-Path $walPath) { (Get-Item $walPath).Length } else { 0 }
  if ($mainBytes -le 4096 -and $walBytes -eq 0) {
    Write-Step ("WARNING: SQLite snapshot at " + $mainPath + " is only " + $mainBytes + " bytes with no WAL payload. This may be an incomplete backup.")
  }
}

function Build-Manifest($snapshotRoot) {
  $files = Get-ChildItem -Path $snapshotRoot -Recurse -File | Sort-Object FullName
  $entries = @()
  foreach ($file in $files) {
    $hash = Get-FileHash -Path $file.FullName -Algorithm SHA256
    $relative = $file.FullName.Substring($snapshotRoot.Length).TrimStart("\", "/")
    $entries += [pscustomobject]@{
      path = $relative
      sha256 = $hash.Hash.ToLowerInvariant()
      bytes = [int64]$file.Length
    }
  }
  return $entries
}

function Prune-OldArtifacts($path, $pattern, $cutoff) {
  if (-not (Test-Path $path)) {
    return
  }
  $items = Get-ChildItem -Path $path -Filter $pattern -ErrorAction SilentlyContinue
  foreach ($item in $items) {
    if ($item.LastWriteTime -ge $cutoff) {
      continue
    }
    if ($DryRun) {
      Write-Step ("DRY RUN: remove " + $item.FullName)
      continue
    }
    Remove-Item -Path $item.FullName -Recurse -Force
    Write-Step ("Pruned: " + $item.FullName)
  }
}

$allowMissingDb = $AllowMissingDbSource -or $AllowMissingDbVolume

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path $RepoRoot).Path
Set-Location $RepoRoot

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$startedAt = (Get-Date).ToString("o")

$snapshotRoot = Join-Path (Join-Path $BackupLocalRoot "snapshots") $timestamp
$archiveRoot = Join-Path $BackupLocalRoot "archives"
$statusRoot = Join-Path $BackupLocalRoot "backup-status"
$statusPath = Join-Path $statusRoot "last-success.json"
$archiveName = "schoology-backup-$timestamp.zip"
$archiveLocalPath = Join-Path $archiveRoot $archiveName
$archiveSyncPath = Join-Path $BackupSyncRoot $archiveName
$snapshotDbRoot = Join-Path $snapshotRoot "db"
$snapshotDbFile = Join-Path $snapshotDbRoot "agent.db.prod"

Ensure-Directory $snapshotRoot
Ensure-Directory $snapshotDbRoot
Ensure-Directory $archiveRoot
Ensure-Directory $statusRoot
if (-not $SkipSyncCopy) {
  Ensure-Directory $BackupSyncRoot
}

$copiedItems = @()

$importantGitignoredFiles = @(
  "data\state.json",
  "data\storage.json",
  "data\agent.db",
  "data\agent.db-wal",
  "data\agent.db-shm",
  "data\beta\state.json",
  "data\beta\storage.json",
  "data\beta\agent.runtime.db",
  "data\beta\agent.runtime.db-wal",
  "data\beta\agent.runtime.db-shm"
)
foreach ($relative in $importantGitignoredFiles) {
  if (Copy-FileIfExists -repoRoot $RepoRoot -snapshotRoot $snapshotRoot -relativePath $relative) {
    $copiedItems += $relative
  }
}

$dbExported = $false
$dbSource = ""
if ($DryRun) {
  Invoke-Docker -DockerArgs @(
    "run",
    "--rm",
    "-v",
    "${ProdVolumeName}:/from:ro",
    "-v",
    "${snapshotDbRoot}:/out",
    $HelperImage,
    "node",
    "--input-type=module",
    "-e",
    "import Database from 'better-sqlite3'; import fs from 'node:fs'; if (fs.existsSync('/from/agent.db')) { const db = new Database('/from/agent.db', { readonly: true, fileMustExist: true }); await db.backup('/out/agent.db.prod'); db.close(); }"
  ) | Out-Null
  $dbExported = $true
  $dbSource = "docker-volume-online-backup"
} else {
  $exportAttempted = $false
  try {
    Invoke-Docker -DockerArgs @(
      "run",
      "--rm",
      "-v",
      "${ProdVolumeName}:/from:ro",
      "-v",
      "${snapshotDbRoot}:/out",
      $HelperImage,
      "node",
      "--input-type=module",
      "-e",
      "import Database from 'better-sqlite3'; import fs from 'node:fs'; if (fs.existsSync('/from/agent.db')) { const db = new Database('/from/agent.db', { readonly: true, fileMustExist: true }); await db.backup('/out/agent.db.prod'); db.close(); }"
    ) | Out-Null
    $exportAttempted = $true
  } catch {
    if ($allowMissingDb) {
      Write-Step "WARNING: Docker DB export command failed; continuing due to allow-missing flag."
      Write-Step ("WARNING detail: " + $_.Exception.Message)
    } else {
      throw
    }
  }

  if ($exportAttempted -and (Test-Path $snapshotDbFile)) {
    $dbExported = $true
    $dbSource = "docker-volume-online-backup"
    Write-Step "Exported prod agent DB from Docker volume via SQLite online backup."
    Warn-IfSuspiciousSqliteSnapshot -mainPath $snapshotDbFile
  } elseif ($allowMissingDb) {
    $dbSource = "docker-volume-missing"
    Write-Step "WARNING: Prod DB snapshot not present; continuing due to allow-missing flag."
  } else {
    throw "Prod DB export failed. Use -AllowMissingDbSource to continue without DB snapshot."
  }
}

$manifestPath = Join-Path $snapshotRoot "manifest.json"
if ($DryRun) {
  Write-Step ("DRY RUN: write manifest " + $manifestPath)
} else {
  $manifest = Build-Manifest -snapshotRoot $snapshotRoot
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8
  Write-Step ("Wrote manifest: " + $manifestPath)
}

if ($DryRun) {
  Write-Step ("DRY RUN: create archive " + $archiveLocalPath)
} else {
  if (Test-Path $archiveLocalPath) {
    Remove-Item -Path $archiveLocalPath -Force
  }
  Compress-Archive -Path (Join-Path $snapshotRoot "*") -DestinationPath $archiveLocalPath -CompressionLevel Optimal
  Write-Step ("Created archive: " + $archiveLocalPath)
}

if (-not $SkipSyncCopy) {
  if ($DryRun) {
    Write-Step ("DRY RUN: copy archive to sync path " + $archiveSyncPath)
  } else {
    Copy-Item -Path $archiveLocalPath -Destination $archiveSyncPath -Force
    Write-Step ("Copied archive to sync path: " + $archiveSyncPath)
  }
}

$cutoff = (Get-Date).AddDays(-1 * [Math]::Abs($RetentionDays))
Prune-OldArtifacts -path (Join-Path $BackupLocalRoot "snapshots") -pattern "*" -cutoff $cutoff
Prune-OldArtifacts -path $archiveRoot -pattern "schoology-backup-*.zip" -cutoff $cutoff
if (-not $SkipSyncCopy) {
  Prune-OldArtifacts -path $BackupSyncRoot -pattern "schoology-backup-*.zip" -cutoff $cutoff
}

$finishedAt = (Get-Date).ToString("o")
$status = [pscustomobject]@{
  startedAt = $startedAt
  finishedAt = $finishedAt
  runtimeMode = $RuntimeMode
  snapshotRoot = $snapshotRoot
  archiveLocalPath = $archiveLocalPath
  archiveSyncPath = $(if ($SkipSyncCopy) { "" } else { $archiveSyncPath })
  manifestPath = $manifestPath
  copiedItems = $copiedItems
  backupContents = @("db\agent.db.prod") + $copiedItems
  sensitiveGitignoredItemsExcluded = @(
    ".env",
    ".env.*",
    "data\secrets\",
    "data\runtime\prod.env",
    "data\runtime\env-backups\"
  )
  dbExported = $dbExported
  dbSource = $dbSource
  retentionDays = $RetentionDays
}
if ($DryRun) {
  Write-Step ("DRY RUN: write status marker " + $statusPath)
} else {
  $status | ConvertTo-Json -Depth 6 | Set-Content -Path $statusPath -Encoding UTF8
  Write-Step ("Updated status marker: " + $statusPath)
}

Write-Step "Done."
