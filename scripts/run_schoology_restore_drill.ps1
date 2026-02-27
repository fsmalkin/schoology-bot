param(
  [ValidateSet("local", "sync")][string]$Source = "local",
  [string]$ArchivePath = "",
  [string]$StatusFile = "D:\backups\schoology\local\backup-status\last-success.json",
  [string]$BackupLocalRoot = "D:\backups\schoology\local",
  [string]$BackupSyncRoot = "D:\backups\schoology\sync",
  [string]$OutputFile = "D:\backups\schoology\local\backup-status\restore-drill.json",
  [switch]$AllowMissingManifest,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[schoology-restore-drill] " + $message)
}

function Resolve-ArchivePath {
  if (-not [string]::IsNullOrWhiteSpace($ArchivePath)) {
    if (-not (Test-Path $ArchivePath)) {
      throw "ArchivePath does not exist: $ArchivePath"
    }
    return (Resolve-Path $ArchivePath).Path
  }

  if (Test-Path $StatusFile) {
    try {
      $status = Get-Content -Path $StatusFile -Raw | ConvertFrom-Json
      $candidate = if ($Source -eq "sync") { [string]$status.archiveSyncPath } else { [string]$status.archiveLocalPath }
      if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
        return (Resolve-Path $candidate).Path
      }
    } catch {
      Write-Step "WARNING: failed to parse status file while resolving archive; falling back to latest archive search."
    }
  }

  $searchRoot = if ($Source -eq "sync") { $BackupSyncRoot } else { Join-Path $BackupLocalRoot "archives" }
  $latest = Get-ChildItem -Path $searchRoot -Filter "schoology-backup-*.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) {
    throw "No backup archives found in $searchRoot"
  }
  return $latest.FullName
}

$resolvedArchivePath = Resolve-ArchivePath
$requiredPaths = @(
  "data\state.json",
  "data\storage.json",
  "data\agent.db",
  "data\beta\state.json",
  "data\beta\storage.json",
  "data\beta\agent.db",
  "data\openclaw-beta",
  "openclaw_workspace"
)

if ($DryRun) {
  Write-Step ("DRY RUN: archive=" + $resolvedArchivePath)
  Write-Step ("DRY RUN: output=" + $OutputFile)
  Write-Step "Done."
  exit 0
}

$archiveHash = (Get-FileHash -Path $resolvedArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$extractRoot = Join-Path $env:TEMP ("schoology-restore-drill-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

$drillResult = $null
try {
  Expand-Archive -Path $resolvedArchivePath -DestinationPath $extractRoot -Force
  Write-Step ("Extracted archive: " + $resolvedArchivePath)

  $missingRequiredPaths = @()
  foreach ($relative in $requiredPaths) {
    $path = Join-Path $extractRoot $relative
    if (-not (Test-Path $path)) {
      $missingRequiredPaths += $relative
    }
  }

  $manifestPath = Join-Path $extractRoot "manifest.json"
  $manifestPresent = Test-Path $manifestPath
  $manifestEntries = @()
  $manifestMissingPaths = @()
  $manifestHashMismatchPaths = @()
  if ($manifestPresent) {
    try {
      $parsedManifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
      $manifestEntries = @($parsedManifest | ForEach-Object { $_ })
    } catch {
      throw "manifest.json exists but is not valid JSON in archive: $resolvedArchivePath"
    }
    foreach ($entry in $manifestEntries) {
      $entryRelative = [string]$entry.path
      if ([string]::IsNullOrWhiteSpace($entryRelative)) {
        continue
      }
      $entryPath = Join-Path $extractRoot ($entryRelative -replace "/", "\")
      if (-not (Test-Path $entryPath)) {
        $manifestMissingPaths += $entryRelative
        continue
      }
      $expected = [string]$entry.sha256
      if ([string]::IsNullOrWhiteSpace($expected)) {
        continue
      }
      $actual = (Get-FileHash -Path $entryPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actual -ne $expected.ToLowerInvariant()) {
        $manifestHashMismatchPaths += $entryRelative
      }
    }
  } elseif (-not $AllowMissingManifest) {
    throw "Archive is missing manifest.json. Use -AllowMissingManifest to bypass."
  }

  $ok = ($missingRequiredPaths.Count -eq 0) -and ($manifestMissingPaths.Count -eq 0) -and ($manifestHashMismatchPaths.Count -eq 0)
  $drillResult = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    source = $Source
    archivePath = $resolvedArchivePath
    archiveName = (Split-Path -Leaf $resolvedArchivePath)
    archiveSha256 = $archiveHash
    archiveBytes = [int64](Get-Item $resolvedArchivePath).Length
    extractRoot = $extractRoot
    requiredPathsChecked = $requiredPaths
    missingRequiredPaths = $missingRequiredPaths
    manifestPresent = $manifestPresent
    manifestEntriesChecked = $manifestEntries.Count
    manifestMissingPaths = $manifestMissingPaths
    manifestHashMismatchPaths = $manifestHashMismatchPaths
    ok = $ok
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $OutputFile) -Force | Out-Null
  $drillResult | ConvertTo-Json -Depth 8 | Set-Content -Path $OutputFile -Encoding UTF8
  Write-Step ("Wrote drill artifact: " + $OutputFile)

  if (-not $ok) {
    Write-Step "Restore drill failed integrity checks."
    exit 1
  }

  Write-Step "Restore drill passed."
  exit 0
} finally {
  if (Test-Path $extractRoot) {
    Remove-Item -Path $extractRoot -Recurse -Force
  }
}
