param(
  [string]$RepoRoot = "",
  [ValidateSet("native", "docker")][string]$RuntimeMode = "native",
  [string]$WslDistro = "Ubuntu-24.04",
  [string]$ProdProject = "schoology-prod",
  [string]$BetaProject = "schoology-openclaw-beta",
  [switch]$NoBuild,
  [switch]$SkipBetaDashboard,
  [switch]$SkipProd,
  [switch]$SkipBeta,
  [switch]$SkipPortCheck,
  [switch]$AllowSharedTelegramToken,
  [switch]$AllowLegacyBeta,
  [switch]$ForceInstall,
  [switch]$KeepAlive,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[start-stacks] " + $message)
}

$script:SchoologyReservedPorts = @(8787, 8788, 18799, 18800)
$script:ChasebotReservedPorts = @(19789, 19790, 19889, 19890)
$script:SchoologyKeepAliveProcessName = "schoology-wsl-keepalive"
$script:SchoologyKeepAlivePidFile = "/tmp/schoology-wsl-keepalive.pid"

function Read-EnvMap($path) {
  $map = @{}
  if (-not (Test-Path $path)) {
    return $map
  }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -match "^(#|$)") {
      return
    }
    $parts = $line -split "=", 2
    if ($parts.Count -lt 2) {
      return
    }
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $map[$name] = $value
  }
  return $map
}

function Get-RequiredPorts() {
  $required = @()
  if (-not $SkipProd) {
    $required += 8787
  }
  if (-not $SkipBeta) {
    $required += 18799
    $required += 18800
    if (-not $SkipBetaDashboard) {
      $required += 8788
    }
  }
  return $required | Sort-Object -Unique
}

function Assert-RequiredPortsFree([int[]]$RequiredPorts) {
  if ($SkipPortCheck -or $RequiredPorts.Count -eq 0) {
    return
  }
  $inUse = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in $RequiredPorts } |
    Select-Object -ExpandProperty LocalPort -Unique
  if ($inUse) {
    throw "Required Schoology ports in use: $($inUse -join ', ')."
  }
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

function Invoke-Wsl([string]$Command, [switch]$Quiet) {
  $display = "wsl -d $WslDistro -- bash -lc `"$Command`""
  if ($DryRun) {
    if (-not $Quiet) {
      Write-Step ("DRY RUN: " + $display)
    }
    return ""
  }
  if (-not $Quiet) {
    Write-Step ("Running: " + $display)
  }
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
  if ($output -and -not $Quiet) {
    $output | Out-Host
  }
  return ($output -join "`n")
}

function Test-WslPortListening([int]$Port) {
  try {
    Invoke-Wsl -Command "ss -ltn | grep -q ':$Port '" -Quiet | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-WslPortListening([int]$Port, [int]$TimeoutSeconds, [string]$Label, [switch]$Required) {
  if ($DryRun) {
    Write-Step ("DRY RUN: wait for $Label on port $Port")
    return $true
  }
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
  while ((Get-Date) -lt $deadline) {
    if (Test-WslPortListening -Port $Port) {
      Write-Step ("$Label listening on port $Port.")
      return $true
    }
    Start-Sleep -Seconds 2
  }
  if ($Required) {
    throw "$Label did not start listening on port $Port within $TimeoutSeconds seconds."
  }
  Write-Step ("WARNING: $Label is not listening on port $Port after $TimeoutSeconds seconds.")
  return $false
}

function Escape-BashSingleQuote([string]$Value) {
  if ($null -eq $Value) {
    return ""
  }
  $replacement = "'" + '"' + "'" + '"' + "'"
  return $Value.Replace("'", $replacement)
}

function Test-WslSystemdUnitActive([string]$UnitName) {
  if ($DryRun) {
    return $false
  }
  try {
    Invoke-Wsl -Command "systemctl is-active --quiet $UnitName" -Quiet | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Test-WslNativeUnitsInstalled {
  if ($DryRun) {
    return $false
  }
  $requiredUnits = @(
    "schoology.target",
    "schoology-prod-scheduler.service",
    "schoology-prod-telegram.service",
    "schoology-prod-dashboard.service",
    "schoology-beta-tool-api.service",
    "schoology-beta-gateway.service",
    "schoology-beta-monitor.service",
    "schoology-beta-dashboard.service",
    "schoology-beta-cron-sync.service",
    "schoology-beta-cron-sync.timer"
  )
  foreach ($unit in $requiredUnits) {
    try {
      Invoke-Wsl -Command "test -f /etc/systemd/system/$unit" -Quiet | Out-Null
    } catch {
      return $false
    }
  }
  return $true
}

function Test-WslKeepAliveProcess {
  if ($DryRun) {
    return $false
  }
  $escapedPidFile = Escape-BashSingleQuote $script:SchoologyKeepAlivePidFile
  try {
    $cmd = [string]::Format('if [ -f ''{0}'' ] && kill -0 "$(cat ''{0}'' 2>/dev/null)" 2>/dev/null; then exit 0; fi; exit 1', $escapedPidFile)
    Invoke-Wsl -Command $cmd -Quiet | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-WslJournalPattern([string]$UnitName, [string]$Pattern, [int]$TimeoutSeconds, [switch]$Required) {
  if ($DryRun) {
    Write-Step ("DRY RUN: wait for journal pattern in ${UnitName}: " + $Pattern)
    return $true
  }
  $escapedPattern = Escape-BashSingleQuote $Pattern
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
  while ((Get-Date) -lt $deadline) {
    try {
      $cmd = "journalctl -u $UnitName --since '-10 minutes' --no-pager | grep -F -q '$escapedPattern'"
      Invoke-Wsl -Command $cmd -Quiet | Out-Null
      Write-Step ("Found journal readiness pattern for ${UnitName}: " + $Pattern)
      return $true
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  if ($Required) {
    throw "Did not observe readiness pattern for $UnitName within $TimeoutSeconds seconds: $Pattern"
  }
  Write-Step ("WARNING: readiness pattern not observed for ${UnitName}: " + $Pattern)
  return $false
}

function Normalize-Path([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return ""
  }
  $resolved = ""
  try {
    $resolved = (Resolve-Path -Path $PathValue -ErrorAction Stop).Path
  } catch {
    $resolved = [System.IO.Path]::GetFullPath($PathValue)
  }
  return $resolved.TrimEnd("\", "/").ToLowerInvariant()
}

function Test-PathOverlap([string]$First, [string]$Second) {
  if ([string]::IsNullOrWhiteSpace($First) -or [string]::IsNullOrWhiteSpace($Second)) {
    return $false
  }
  if ($First -eq $Second) {
    return $true
  }
  return $First.StartsWith($Second + "\") -or $Second.StartsWith($First + "\")
}

function Write-CoexistenceValidationReport([string]$Phase, [string]$RepoRootPath) {
  $allReservedPorts = @($script:SchoologyReservedPorts + $script:ChasebotReservedPorts | Sort-Object -Unique)
  $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in $allReservedPorts } |
    Sort-Object LocalPort |
    Select-Object LocalAddress, LocalPort, OwningProcess
  if ($listeners) {
    $summary = $listeners | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)/pid=$($_.OwningProcess)" }
    Write-Step ("$Phase reserved-port listeners: " + ($summary -join "; "))
  } else {
    Write-Step ("$Phase reserved-port listeners: none")
  }

  $schoologyRoots = @(
    (Join-Path $RepoRootPath "data"),
    (Join-Path $RepoRootPath "openclaw_workspace")
  )
  $chasebotRoots = @()
  if (Test-Path "D:\dev\openclaw") {
    $chasebotRoots = Get-ChildItem -Path "D:\dev\openclaw" -Directory -Filter ".openclaw-*" -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName
  }

  $normalizedSchoology = @($schoologyRoots | ForEach-Object { Normalize-Path $_ })
  $normalizedChasebot = @($chasebotRoots | ForEach-Object { Normalize-Path $_ })
  foreach ($schoologyRoot in $normalizedSchoology) {
    foreach ($chasebotRoot in $normalizedChasebot) {
      if (Test-PathOverlap -First $schoologyRoot -Second $chasebotRoot) {
        throw "State path collision detected between Schoology and Chasebot: $schoologyRoot <-> $chasebotRoot"
      }
    }
  }

  $pathSummary = @()
  foreach ($root in $normalizedSchoology) {
    $pathSummary += ("schoology=" + $root)
  }
  foreach ($root in $normalizedChasebot) {
    $pathSummary += ("chasebot=" + $root)
  }
  if ($pathSummary) {
    Write-Step ("$Phase state-root check: " + ($pathSummary -join "; "))
  }
}

function Assert-HttpHealth([string]$Url, [string]$Label) {
  if ($DryRun) {
    Write-Step ("DRY RUN: health check " + $Url)
    return
  }
  try {
    $response = Invoke-RestMethod $Url -TimeoutSec 5
    Write-Step ("$Label health ok: " + ($response | ConvertTo-Json -Compress))
  } catch {
    throw "$Label health check failed at ${Url}: $($_.Exception.Message)"
  }
}

function Convert-WindowsPathToWsl([string]$WindowsPath) {
  if ($DryRun) {
    $candidate = $WindowsPath -replace "\\", "/"
    if ($candidate -match "^[A-Za-z]:") {
      $drive = $candidate.Substring(0, 1).ToLowerInvariant()
      return "/mnt/$drive" + $candidate.Substring(2)
    }
    return $candidate
  }
  $escaped = Escape-BashSingleQuote $WindowsPath
  $wslPath = Invoke-Wsl -Command "wslpath -a '$escaped'" -Quiet
  return ($wslPath -split "`r?`n" | Select-Object -First 1).Trim()
}

function Assert-BetaModelAuthHealthy([string]$RepoRootPath, [switch]$Required) {
  if ($DryRun -or $SkipBeta) {
    return $true
  }
  $repoWsl = Convert-WindowsPathToWsl -WindowsPath $RepoRootPath
  $stateWsl = "$repoWsl/data/openclaw-beta"
  $workspaceWsl = "$repoWsl/openclaw_workspace"
  $envFileWsl = "$repoWsl/.env.beta.systemd"
  $cmd = "set -a; source $envFileWsl 2>/dev/null || true; set +a; cd $repoWsl/vendor/openclaw && OPENCLAW_STATE_DIR=$stateWsl OPENCLAW_WORKSPACE_DIR=$workspaceWsl HOME=$stateWsl node dist/index.js models status --json"
  $raw = Invoke-Wsl -Command $cmd -Quiet
  if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "Beta model auth check returned empty output."
  }
  try {
    $status = $raw | ConvertFrom-Json
  } catch {
    throw "Beta model auth check did not return valid JSON."
  }
  $missingProviders = @()
  if ($status.auth -and $status.auth.missingProvidersInUse) {
    $missingProviders = @($status.auth.missingProvidersInUse | ForEach-Object { [string]$_ })
  }
  if ($missingProviders -contains "anthropic") {
    if ($Required) {
      throw "Beta model auth missing provider anthropic. Configure Schoology beta auth profile before UAT."
    }
    Write-Step "WARNING: Beta model auth missing provider anthropic."
    return $false
  }
  Write-Step ("Beta model auth check passed (missingProvidersInUse=" + ($missingProviders -join ",") + ").")
  return $true
}

function Start-WslKeepAliveSession {
  if ($DryRun) {
    Write-Step ("DRY RUN: keepalive session for " + $script:SchoologyKeepAliveProcessName)
    return
  }
  $escapedPidFile = Escape-BashSingleQuote $script:SchoologyKeepAlivePidFile
  $escapedName = Escape-BashSingleQuote $script:SchoologyKeepAliveProcessName
  $scriptTemplate = @'
#!/usr/bin/env bash
set -euo pipefail
pid_file='{0}'
if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file" 2>/dev/null)" 2>/dev/null; then
  echo '{1} already running'
  exit 0
fi
rm -f "$pid_file"
echo $$ > "$pid_file"
cleanup() {{ rm -f "$pid_file"; }}
trap cleanup EXIT INT TERM
echo 'starting {1}'
while true; do
  sleep 3600
done
'@
  $scriptBody = [string]::Format($scriptTemplate, $escapedPidFile, $escapedName)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($scriptBody -replace "`r", "")))
  $writeCmd = "echo '$encoded' | base64 -d > /tmp/schoology-wsl-keepalive.sh && chmod 700 /tmp/schoology-wsl-keepalive.sh"
  Invoke-Wsl -Command $writeCmd -Quiet | Out-Null
  Write-Step "KeepAlive enabled; attaching foreground WSL session to keep Schoology runtime resident."
  $previous = $ErrorActionPreference
  $output = $null
  $exitCode = 0
  try {
    $ErrorActionPreference = "Continue"
    $output = & wsl -d $WslDistro --user root -- bash /tmp/schoology-wsl-keepalive.sh 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($output) {
    $output | Out-Host
  }
  if ($exitCode -ne 0) {
    throw "KeepAlive session failed with exit code $exitCode."
  }
  Write-Step "KeepAlive session exited."
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path $RepoRoot).Path
Set-Location $RepoRoot

foreach ($required in @(".env", ".env.beta")) {
  if (-not (Test-Path $required)) {
    throw "Missing $required in $RepoRoot"
  }
}

$prodEnv = Read-EnvMap ".env"
$betaEnv = Read-EnvMap ".env.beta"

$betaGatewayToken = ""
if ($betaEnv.ContainsKey("OPENCLAW_GATEWAY_TOKEN")) {
  $betaGatewayToken = ([string]$betaEnv["OPENCLAW_GATEWAY_TOKEN"]).Trim()
}
if ([string]::IsNullOrWhiteSpace($betaGatewayToken) -and -not $SkipBeta) {
  throw "OPENCLAW_GATEWAY_TOKEN is required in .env.beta"
}

if (-not $AllowSharedTelegramToken) {
  $prodToken = ""
  if ($prodEnv.ContainsKey("TELEGRAM_BOT_TOKEN")) {
    $prodToken = ([string]$prodEnv["TELEGRAM_BOT_TOKEN"]).Trim()
  }
  $betaToken = ""
  if ($betaEnv.ContainsKey("TELEGRAM_BOT_TOKEN")) {
    $betaToken = ([string]$betaEnv["TELEGRAM_BOT_TOKEN"]).Trim()
  }
  if (-not [string]::IsNullOrWhiteSpace($prodToken) -and $prodToken -eq $betaToken) {
    throw "Prod and beta TELEGRAM_BOT_TOKEN values must differ. Use -AllowSharedTelegramToken to override."
  }
}

$keepAliveAlreadyRunning = $false
if ($RuntimeMode -eq "native" -and $KeepAlive -and -not $DryRun) {
  $keepAliveAlreadyRunning = Test-WslKeepAliveProcess
  if ($keepAliveAlreadyRunning -and -not (Test-WslSystemdUnitActive -UnitName "schoology.target")) {
    Write-Step "Detected stale keepalive marker with inactive schoology.target; proceeding with full startup."
    $keepAliveAlreadyRunning = $false
  }
  if ($keepAliveAlreadyRunning) {
    Write-Step "Existing Schoology keepalive process detected; startup will validate readiness without disruptive restart."
  }
}
$nativeStackAlreadyActive = $false
if ($RuntimeMode -eq "native" -and -not $DryRun) {
  $nativeStackAlreadyActive = Test-WslSystemdUnitActive -UnitName "schoology.target"
  if ($nativeStackAlreadyActive -and -not $keepAliveAlreadyRunning) {
    Write-Step "Detected active schoology.target; startup will perform in-place restart."
  }
}
$nativeUnitsInstalled = $false
if ($RuntimeMode -eq "native" -and -not $DryRun) {
  $nativeUnitsInstalled = Test-WslNativeUnitsInstalled
}

Write-CoexistenceValidationReport -Phase "preflight" -RepoRootPath $RepoRoot

$requiredPorts = Get-RequiredPorts
if ($keepAliveAlreadyRunning -or $nativeStackAlreadyActive) {
  Write-Step "Skipping free-port precheck because native Schoology stack is already active."
} else {
  Assert-RequiredPortsFree -RequiredPorts $requiredPorts
}

if (-not $AllowLegacyBeta -and (Test-Path "docker-compose.beta.yml")) {
  Write-Step "Legacy beta compose (docker-compose.beta.yml) is deprecated and intentionally not started by this script."
}

if ($RuntimeMode -eq "native") {
  if ($NoBuild) {
    Write-Step "-NoBuild has no effect in native mode."
  }

  if (-not $keepAliveAlreadyRunning) {
    $installScript = Join-Path $RepoRoot "scripts\install_schoology_native_services.ps1"
    if (-not (Test-Path $installScript)) {
      throw "Missing required native installer script: $installScript"
    }

    $shouldRunInstaller = $ForceInstall -or $DryRun -or (-not $nativeUnitsInstalled)
    if ($shouldRunInstaller) {
      $installArgs = @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $installScript,
        "-RepoRoot",
        $RepoRoot,
        "-WslDistro",
        $WslDistro
      )
      if ($DryRun) {
        $installArgs += "-DryRun"
      } else {
        $installArgs += "-EnableNow"
      }
      Write-Step ("Running installer: powershell " + ($installArgs -join " "))
      if (-not $DryRun) {
        & powershell @installArgs
        if ($LASTEXITCODE -ne 0) {
          throw "Native service installer failed."
        }
        $nativeUnitsInstalled = $true
      }
    } else {
      Write-Step "Native units already installed; skipping installer (use -ForceInstall to reinstall)."
    }

    if ($SkipProd) {
      Invoke-Wsl -Command "sudo systemctl stop schoology-prod-dashboard.service schoology-prod-telegram.service schoology-prod-scheduler.service || true" | Out-Null
    } else {
      Invoke-Wsl -Command "sudo systemctl restart schoology-prod-scheduler.service schoology-prod-telegram.service schoology-prod-dashboard.service" | Out-Null
    }

    if ($SkipBeta) {
      Invoke-Wsl -Command "sudo systemctl stop schoology-beta-dashboard.service schoology-beta-monitor.service schoology-beta-gateway.service schoology-beta-tool-api.service schoology-beta-cron-sync.timer || true" | Out-Null
    } else {
      $betaServices = @(
        "schoology-beta-tool-api.service",
        "schoology-beta-gateway.service",
        "schoology-beta-monitor.service"
      )
      if (-not $SkipBetaDashboard) {
        $betaServices += "schoology-beta-dashboard.service"
      } else {
        Invoke-Wsl -Command "sudo systemctl stop schoology-beta-dashboard.service || true" | Out-Null
      }
      Invoke-Wsl -Command ("sudo systemctl restart " + ($betaServices -join " ")) | Out-Null
      Invoke-Wsl -Command "sudo systemctl enable --now schoology-beta-cron-sync.timer" | Out-Null
      Invoke-Wsl -Command "sudo systemctl start --no-block schoology-beta-cron-sync.service || true" | Out-Null
    }
  } else {
    Write-Step "KeepAlive stack already active; skipping native installer and service restarts."
  }

  Invoke-Wsl -Command "sudo systemctl --no-pager --full status schoology.target schoology-beta-cron-sync.timer --lines=0 || true" | Out-Null

  if (-not $DryRun) {
    if (-not $SkipBeta) {
      $null = Wait-WslPortListening -Port 3030 -TimeoutSeconds 120 -Label "Schoology beta tool-api" -Required
      $null = Wait-WslPortListening -Port 18799 -TimeoutSeconds 300 -Label "Schoology OpenClaw gateway" -Required
      $null = Wait-WslJournalPattern -UnitName "schoology-beta-gateway.service" -Pattern "starting provider (@schoology_beta_bot)" -TimeoutSeconds 240 -Required
      $bridgeReady = Wait-WslPortListening -Port 18800 -TimeoutSeconds 30 -Label "Schoology reserved beta bridge/derived port"
      if (-not $bridgeReady) {
        Write-Step "INFO: port 18800 is reserved for Schoology coexistence but may be unused on current OpenClaw builds."
      }
      $null = Assert-BetaModelAuthHealthy -RepoRootPath $RepoRoot
    }

    if (-not $SkipProd) {
      Assert-HttpHealth -Url "http://127.0.0.1:8787/api/health" -Label "Prod dashboard"
    }
    if (-not $SkipBeta -and -not $SkipBetaDashboard) {
      Assert-HttpHealth -Url "http://127.0.0.1:8788/api/health" -Label "Beta dashboard"
    }
  }

  Write-CoexistenceValidationReport -Phase "post-start" -RepoRootPath $RepoRoot
  if ($KeepAlive) {
    Start-WslKeepAliveSession
  }

  Write-Step "Done."
  exit 0
}

if (-not (Test-Path "docker-compose.yml")) {
  throw "Missing docker-compose.yml in $RepoRoot"
}
if (-not (Test-Path "docker-compose.beta-openclaw.yml")) {
  throw "Missing docker-compose.beta-openclaw.yml in $RepoRoot"
}

if (-not $SkipProd) {
  $prodUp = @("compose", "-f", "docker-compose.yml", "-p", $ProdProject, "up", "-d")
  if (-not $NoBuild) {
    $prodUp += "--build"
  }
  Invoke-Docker -DockerArgs $prodUp | Out-Null
}

if (-not $SkipBeta) {
  foreach ($dir in @("data", "data\beta", "data\beta\health", "data\openclaw-beta", "openclaw_workspace")) {
    if (-not (Test-Path $dir)) {
      if ($DryRun) {
        Write-Step ("DRY RUN: create directory " + $dir)
      } else {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
      }
    }
  }

  $betaUpArgs = @(
    "compose",
    "--env-file",
    ".env.beta",
    "-f",
    "docker-compose.beta-openclaw.yml",
    "-p",
    $BetaProject
  )
  if (-not $SkipBetaDashboard) {
    $betaUpArgs += @("--profile", "dashboard")
  }
  $betaUpArgs += @("up", "-d")
  if (-not $NoBuild) {
    $betaUpArgs += "--build"
  }
  Invoke-Docker -DockerArgs $betaUpArgs | Out-Null

  $stopCronArgs = @(
    "compose",
    "--env-file",
    ".env.beta",
    "-f",
    "docker-compose.beta-openclaw.yml",
    "-p",
    $BetaProject,
    "stop",
    "openclaw-cron-sync"
  )
  Invoke-Docker -DockerArgs $stopCronArgs | Out-Null

  $bootstrapCmd = 'node dist/index.js cron list --all --url ws://127.0.0.1:18789 --token "$OPENCLAW_GATEWAY_TOKEN" --json'
  $bootstrapArgs = @(
    "compose",
    "--env-file",
    ".env.beta",
    "-f",
    "docker-compose.beta-openclaw.yml",
    "-p",
    $BetaProject,
    "exec",
    "-T",
    "openclaw-gateway",
    "sh",
    "-lc",
    $bootstrapCmd
  )
  Invoke-Docker -DockerArgs $bootstrapArgs | Out-Null

  $startCronArgs = @(
    "compose",
    "--env-file",
    ".env.beta",
    "-f",
    "docker-compose.beta-openclaw.yml",
    "-p",
    $BetaProject,
    "up",
    "-d",
    "openclaw-cron-sync"
  )
  Invoke-Docker -DockerArgs $startCronArgs | Out-Null
}

if (-not $SkipProd) {
  Invoke-Docker -DockerArgs @("compose", "-f", "docker-compose.yml", "-p", $ProdProject, "ps") | Out-Null
}
if (-not $SkipBeta) {
  Invoke-Docker -DockerArgs @(
    "compose",
    "--env-file",
    ".env.beta",
    "-f",
    "docker-compose.beta-openclaw.yml",
    "-p",
    $BetaProject,
    "ps"
  ) | Out-Null
}

Write-Step "Done."
