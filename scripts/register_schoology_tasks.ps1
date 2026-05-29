param(
  [string]$RepoRoot = "",
  [ValidateSet("docker")][string]$RuntimeMode = "docker",
  [string]$WslDistro = "Ubuntu-24.04",
  [string]$BackupLocalRoot = "D:\backups\schoology\local",
  [string]$BackupSyncRoot = "D:\backups\schoology\sync",
  [string]$DailyBackupTime = "02:30",
  [string]$DailyCatalogTime = "03:00",
  [string]$MonthlyRestoreDrillTime = "04:00",
  [string]$RunAsUser = $env:USERNAME,
  [object]$RunAsPassword = $null,
  [switch]$RunHighest,
  [switch]$DisableStartupFallback,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[schoology-tasks] " + $message)
}

function Convert-ToPlainPassword([object]$PasswordInput) {
  if ($null -eq $PasswordInput) {
    return ""
  }
  if ($PasswordInput -is [System.Security.SecureString]) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PasswordInput)
    try {
      return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }
  return [string]$PasswordInput
}

function Get-StartupFallbackPath {
  $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  return (Join-Path $startupDir "Schoology-StartStacks-OnLogon.cmd")
}

function Remove-StartupFallback {
  $startupCmd = Get-StartupFallbackPath
  if ($DryRun) {
    Write-Step ("DRY RUN: remove startup fallback if present " + $startupCmd)
    return
  }
  if (Test-Path $startupCmd) {
    Remove-Item -Path $startupCmd -Force
    Write-Step ("Removed startup fallback: " + $startupCmd)
  } else {
    Write-Step "Startup fallback already absent."
  }
}

function Install-StartupFallback($repoRoot, $runtimeMode, $wslDistro) {
  $startupDir = Split-Path -Parent (Get-StartupFallbackPath)
  $startupCmd = Get-StartupFallbackPath
  $startScript = Join-Path $repoRoot "scripts\start_schoology_stacks.ps1"
  $contents = @(
    "@echo off",
    "powershell -NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -RepoRoot `"$repoRoot`" -RuntimeMode $runtimeMode -WslDistro `"$wslDistro`""
  ) -join "`r`n"

  if ($DryRun) {
    Write-Step ("DRY RUN: write startup fallback " + $startupCmd)
    return
  }
  New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
  Set-Content -Path $startupCmd -Value $contents -Encoding ASCII
  Write-Step ("Installed startup fallback: " + $startupCmd)
}

function Format-SchtasksArgsForDisplay([string[]]$TaskArgs) {
  $masked = @()
  for ($i = 0; $i -lt $TaskArgs.Count; $i++) {
    $arg = [string]$TaskArgs[$i]
    $masked += $arg
    if ($arg.ToUpperInvariant() -eq "/RP" -and ($i + 1) -lt $TaskArgs.Count) {
      $i++
      $masked += "<redacted>"
    }
  }
  return $masked
}

function Invoke-Schtasks([string[]]$TaskArgs) {
  $displayArgs = Format-SchtasksArgsForDisplay -TaskArgs $TaskArgs
  $display = "schtasks " + ($displayArgs -join " ")
  if ($DryRun) {
    Write-Step ("DRY RUN: " + $display)
    return
  }
  Write-Step ("Running: " + $display)
  $output = & schtasks @TaskArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks command failed: $display`n$($output -join "`n")"
  }
  if ($output) {
    $output | Out-Host
  }
}

function Assert-TaskRegistered([string]$TaskName) {
  if ($DryRun) {
    Write-Step ("DRY RUN: validate task " + $TaskName)
    return
  }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    throw "Required scheduled task is missing: $TaskName"
  }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Step ("Task validated: " + $TaskName + " state=" + $task.State + " lastRun=" + $info.LastRunTime + " nextRun=" + $info.NextRunTime)
}

function Assert-TaskPasswordLogon([string]$TaskName) {
  if ($DryRun) {
    Write-Step ("DRY RUN: validate password logon mode for task " + $TaskName)
    return
  }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    throw "Cannot validate logon mode; task is missing: $TaskName"
  }
  $logonType = [string]$task.Principal.LogonType
  if ($logonType -ne "Password") {
    throw "Task $TaskName has logon mode '$logonType'; expected 'Password' for non-interactive execution."
  }
  Write-Step ("Task logon mode validated: " + $TaskName + " logonType=" + $logonType)
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path $RepoRoot).Path
$resolvedRunAsPassword = Convert-ToPlainPassword -PasswordInput $RunAsPassword

$backupScript = Join-Path $RepoRoot "scripts\backup_schoology_state.ps1"
$freshnessScript = Join-Path $RepoRoot "scripts\check_schoology_backup_freshness.ps1"
$startScript = Join-Path $RepoRoot "scripts\start_schoology_stacks.ps1"
$catalogScript = Join-Path $RepoRoot "scripts\backup_schoology_catalog_github.ps1"
$restoreDrillScript = Join-Path $RepoRoot "scripts\run_schoology_restore_drill.ps1"

foreach ($path in @($backupScript, $freshnessScript, $startScript, $catalogScript, $restoreDrillScript)) {
  if (-not (Test-Path $path)) {
    throw "Missing script required for task registration: $path"
  }
}

$taskBackup = "Schoology-Backup-Daily"
$taskFreshness = "Schoology-Backup-FreshnessHourly"
$taskStartBoot = "Schoology-StartStacks-OnBoot"
$taskStartLogon = "Schoology-StartStacks-OnLogon"
$taskCatalog = "Schoology-Backup-Catalog-Daily"
$taskRestoreDrill = "Schoology-RestoreDrill-Monthly"

$rlArgs = @()
if ($RunHighest) {
  $rlArgs = @("/RL", "HIGHEST")
}
$ruArgs = @()
if (-not [string]::IsNullOrWhiteSpace($RunAsUser)) {
  if ([string]::IsNullOrWhiteSpace($resolvedRunAsPassword)) {
    throw "RunAsPassword is required when RunAsUser is specified so tasks run non-interactively."
  }
  $ruArgs = @("/RU", $RunAsUser, "/RP", $resolvedRunAsPassword)
}

$backupCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$backupScript`" -RepoRoot `"$RepoRoot`" -RuntimeMode $RuntimeMode -BackupLocalRoot `"$BackupLocalRoot`" -BackupSyncRoot `"$BackupSyncRoot`""
$freshnessStatusPath = Join-Path $BackupLocalRoot "backup-status\last-success.json"
$freshnessCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$freshnessScript`" -StatusFile `"$freshnessStatusPath`" -MaxAgeHours 24"
$startSkipPortCheckArg = " -SkipPortCheck"
$startCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -RepoRoot `"$RepoRoot`" -RuntimeMode $RuntimeMode -WslDistro `"$WslDistro`"$startSkipPortCheckArg"
$catalogCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$catalogScript`""
$restoreDrillCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$restoreDrillScript`" -Source local"

if ($DisableStartupFallback -or $RuntimeMode -eq "docker") {
  Remove-StartupFallback
} else {
  Install-StartupFallback -repoRoot $RepoRoot -runtimeMode $RuntimeMode -wslDistro $WslDistro
}

Invoke-Schtasks -TaskArgs (@(
    "/Create",
    "/TN",
    $taskBackup,
    "/SC",
    "DAILY",
    "/ST",
    $DailyBackupTime,
    "/TR",
    $backupCommand,
    "/F"
  ) + $ruArgs + $rlArgs)

Invoke-Schtasks -TaskArgs (@(
    "/Create",
    "/TN",
    $taskFreshness,
    "/SC",
    "HOURLY",
    "/MO",
    "1",
    "/TR",
    $freshnessCommand,
    "/F"
  ) + $ruArgs + $rlArgs)

Invoke-Schtasks -TaskArgs (@(
    "/Create",
    "/TN",
    $taskCatalog,
    "/SC",
    "DAILY",
    "/ST",
    $DailyCatalogTime,
    "/TR",
    $catalogCommand,
    "/F"
  ) + $ruArgs + $rlArgs)

Invoke-Schtasks -TaskArgs (@(
    "/Create",
    "/TN",
    $taskRestoreDrill,
    "/SC",
    "MONTHLY",
    "/D",
    "1",
    "/ST",
    $MonthlyRestoreDrillTime,
    "/TR",
    $restoreDrillCommand,
    "/F"
  ) + $ruArgs + $rlArgs)

Invoke-Schtasks -TaskArgs (@(
    "/Create",
    "/TN",
    $taskStartBoot,
    "/SC",
    "ONSTART",
    "/TR",
    $startCommand,
    "/DELAY",
    "0001:00",
    "/F"
  ) + $ruArgs + $rlArgs)

Invoke-Schtasks -TaskArgs (@(
    "/Create",
    "/TN",
    $taskStartLogon,
    "/SC",
    "ONLOGON",
    "/TR",
    $startCommand,
    "/F"
  ) + $ruArgs + $rlArgs)

foreach ($taskName in @($taskBackup, $taskFreshness, $taskCatalog, $taskRestoreDrill, $taskStartBoot, $taskStartLogon)) {
  Invoke-Schtasks -TaskArgs @("/Query", "/TN", $taskName, "/V", "/FO", "LIST")
  Assert-TaskRegistered -TaskName $taskName
  if (-not [string]::IsNullOrWhiteSpace($RunAsUser)) {
    Assert-TaskPasswordLogon -TaskName $taskName
  }
}

Write-Step "Done."
