param(
  [string]$RepoRoot = "",
  [string]$BackupRoot = "D:\backups\schoology",
  [string]$SnapshotPrefix = "pre-native-cutover",
  [switch]$IncludeChasebotTasks,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[schoology-precutover] " + $message)
}

function Ensure-Directory([string]$Path) {
  if ($DryRun) {
    Write-Step ("DRY RUN: mkdir -p " + $Path)
    return
  }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Copy-RelativePath([string]$BasePath, [string]$SnapshotRoot, [string]$RelativePath) {
  $source = Join-Path $BasePath $RelativePath
  if (-not (Test-Path $source)) {
    Write-Step ("Skip missing path: " + $RelativePath)
    return $false
  }
  $target = Join-Path $SnapshotRoot $RelativePath
  $targetParent = Split-Path -Parent $target
  Ensure-Directory $targetParent
  if ($DryRun) {
    Write-Step ("DRY RUN: copy " + $RelativePath)
    return $true
  }
  if ((Get-Item $source).PSIsContainer) {
    Copy-Item -Path $source -Destination $target -Recurse -Force
  } else {
    Copy-Item -Path $source -Destination $target -Force
  }
  Write-Step ("Copied: " + $RelativePath)
  return $true
}

function Build-Manifest([string]$SnapshotRoot) {
  $files = Get-ChildItem -Path $SnapshotRoot -Recurse -File | Sort-Object FullName
  $entries = @()
  foreach ($file in $files) {
    $hash = Get-FileHash -Path $file.FullName -Algorithm SHA256
    $relative = $file.FullName.Substring($SnapshotRoot.Length).TrimStart("\", "/")
    $entries += [pscustomobject]@{
      path = $relative
      sha256 = $hash.Hash.ToLowerInvariant()
      bytes = [int64]$file.Length
    }
  }
  return $entries
}

function Export-TaskDefinitions([string]$TasksRoot, [string[]]$NamePatterns) {
  $exports = @()
  $getTaskCmd = Get-Command "Get-ScheduledTask" -ErrorAction SilentlyContinue
  if (-not $getTaskCmd) {
    Write-Step "WARNING: ScheduledTasks module is unavailable; skipping task export."
    return $exports
  }

  $tasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $name = [string]$_.TaskName
    foreach ($pattern in $NamePatterns) {
      if ($name -like $pattern) {
        return $true
      }
    }
    return $false
  }

  if (-not $tasks) {
    Write-Step "No matching scheduled tasks found to export."
    return $exports
  }

  Ensure-Directory $TasksRoot
  foreach ($task in $tasks) {
    $taskName = [string]$task.TaskName
    $taskPath = [string]$task.TaskPath
    $safePath = ($taskPath.Trim("\") + "_" + $taskName) -replace "[\\/:*?""<>|]", "_"
    if ([string]::IsNullOrWhiteSpace($safePath)) {
      $safePath = $taskName
    }
    $xmlPath = Join-Path $TasksRoot ($safePath + ".xml")
    if ($DryRun) {
      Write-Step ("DRY RUN: export task " + $taskPath + $taskName + " -> " + $xmlPath)
    } else {
      $xml = Export-ScheduledTask -TaskName $taskName -TaskPath $taskPath
      $xml | Set-Content -Path $xmlPath -Encoding UTF8
      Write-Step ("Exported task: " + $taskPath + $taskName)
    }
    $exports += [pscustomobject]@{
      taskName = $taskName
      taskPath = $taskPath
      xmlPath = $xmlPath
    }
  }
  return $exports
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path $RepoRoot).Path

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$snapshotName = "$SnapshotPrefix-$timestamp"
$snapshotRoot = Join-Path $BackupRoot $snapshotName
$tasksRoot = Join-Path $snapshotRoot "scheduled-tasks"
$manifestPath = Join-Path $snapshotRoot "manifest.sha256.json"
$summaryPath = Join-Path $snapshotRoot "snapshot-summary.json"
$taskIndexPath = Join-Path $tasksRoot "task-export-index.json"

Ensure-Directory $snapshotRoot

$copied = @()
foreach ($relativePath in @("data", ".env", ".env.beta", "scripts")) {
  if (Copy-RelativePath -BasePath $RepoRoot -SnapshotRoot $snapshotRoot -RelativePath $relativePath) {
    $copied += $relativePath
  }
}

$patterns = @("Schoology-*")
if ($IncludeChasebotTasks) {
  $patterns += "Chasebot-*"
}
$taskExports = Export-TaskDefinitions -TasksRoot $tasksRoot -NamePatterns $patterns

if ($DryRun) {
  Write-Step ("DRY RUN: write task index " + $taskIndexPath)
  Write-Step ("DRY RUN: write manifest " + $manifestPath)
  Write-Step ("DRY RUN: write summary " + $summaryPath)
  Write-Step "Done."
  exit 0
}

if ($taskExports.Count -gt 0) {
  $taskExports | ConvertTo-Json -Depth 6 | Set-Content -Path $taskIndexPath -Encoding UTF8
}

$manifest = Build-Manifest -SnapshotRoot $snapshotRoot
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

$summary = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  snapshotName = $snapshotName
  snapshotRoot = $snapshotRoot
  copiedPaths = $copied
  taskPatterns = $patterns
  tasksExported = $taskExports.Count
  manifestPath = $manifestPath
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath -Encoding UTF8

Get-ChildItem -Path $snapshotRoot -Recurse -File | ForEach-Object {
  $_.IsReadOnly = $true
}

Write-Step ("Snapshot complete: " + $snapshotRoot)
