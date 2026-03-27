param(
  [string]$RepoRoot = "",
  [string]$WslDistro = "Ubuntu-24.04",
  [string]$BetaGatewayRuntimeWsl = "/root/schoology-openclaw-code",
  [switch]$SkipBetaGatewayRuntimeSync,
  [switch]$EnableNow,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[schoology-native-install] " + $message)
}

function Convert-ToWslPath([string]$WindowsPath) {
  $normalized = $WindowsPath -replace "\\", "/"
  if ($normalized -match "^([A-Za-z]):/(.*)$") {
    $drive = $matches[1].ToLowerInvariant()
    $rest = $matches[2]
    return "/mnt/$drive/$rest"
  }
  throw "Cannot convert Windows path to WSL path: $WindowsPath"
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

function Write-WslFile([string]$WslPath, [string]$Body) {
  if ($DryRun) {
    Write-Step ("DRY RUN: write file " + $WslPath)
    return
  }
  $payload = $Body -replace "`r", ""
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
  $cmd = "echo '$b64' | base64 -d | sudo tee '$WslPath' > /dev/null"
  try {
    Invoke-Wsl -Command $cmd -Quiet | Out-Null
  } catch {
    throw "Failed to write WSL file: $WslPath"
  }
}

function Write-SystemdUnit([string]$UnitName, [string]$Body) {
  Write-WslFile -WslPath "/etc/systemd/system/$UnitName" -Body $Body
  Write-Step ("Wrote /etc/systemd/system/$UnitName")
}

function Write-SystemdEnvFile([string]$SourcePath, [string]$TargetWslPath) {
  if (-not (Test-Path $SourcePath)) {
    throw "Missing env file: $SourcePath"
  }
  $raw = Get-Content -Path $SourcePath -Raw
  $bom = [string][char]0xFEFF
  if ($raw.StartsWith($bom)) {
    $raw = $raw.Substring(1)
  }
  Write-WslFile -WslPath $TargetWslPath -Body ($raw -replace "`r", "")
  Write-Step ("Wrote $TargetWslPath from " + (Split-Path -Leaf $SourcePath))
}

function Escape-BashSingleQuote([string]$Value) {
  if ($null -eq $Value) {
    return ""
  }
  $replacement = "'" + '"' + "'" + '"' + "'"
  return $Value.Replace("'", $replacement)
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path $RepoRoot).Path

$requiredLocalDirs = @(
  "data",
  "data\beta",
  "data\beta\health",
  "data\openclaw-beta",
  "data\openclaw-beta\agents",
  "data\openclaw-beta\identity",
  "data\openclaw-beta\workspace",
  "openclaw_workspace"
)
foreach ($dir in $requiredLocalDirs) {
  $path = Join-Path $RepoRoot $dir
  if (-not (Test-Path $path)) {
    if ($DryRun) {
      Write-Step ("DRY RUN: create " + $path)
    } else {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
      Write-Step ("Created " + $path)
    }
  }
}

$repoWsl = Convert-ToWslPath -WindowsPath $RepoRoot
$stateWsl = "$repoWsl/data/openclaw-beta"
$workspaceWsl = "$repoWsl/openclaw_workspace"
$betaGatewayRuntimeWsl = $BetaGatewayRuntimeWsl.Trim()
if ([string]::IsNullOrWhiteSpace($betaGatewayRuntimeWsl)) {
  throw "BetaGatewayRuntimeWsl cannot be empty."
}
$prodEnvSource = Join-Path $RepoRoot ".env"
$betaEnvSource = Join-Path $RepoRoot ".env.beta"
$prodEnvWsl = "$repoWsl/.env.systemd"
$betaEnvWsl = "$repoWsl/.env.beta.systemd"

if (-not $SkipBetaGatewayRuntimeSync) {
  $repoOpenclawWsl = "$repoWsl/vendor/openclaw"
  $escapedRepoOpenclawWsl = Escape-BashSingleQuote $repoOpenclawWsl
  $escapedRuntimeWsl = Escape-BashSingleQuote $betaGatewayRuntimeWsl

  Invoke-Wsl -Command "sudo mkdir -p '$escapedRuntimeWsl'" | Out-Null
  $syncCmd = "if command -v rsync >/dev/null 2>&1; then sudo rsync -a --delete '$escapedRepoOpenclawWsl/' '$escapedRuntimeWsl/'; else sudo rm -rf '$escapedRuntimeWsl'/* && sudo cp -a '$escapedRepoOpenclawWsl/.' '$escapedRuntimeWsl/'; fi"
  Invoke-Wsl -Command $syncCmd | Out-Null

  $depsCmd = "if [ ! -d '$escapedRuntimeWsl/node_modules' ] || [ ! -d '$escapedRuntimeWsl/node_modules/commander' ]; then cd '$escapedRuntimeWsl' && sudo env CI=true pnpm install --frozen-lockfile; fi"
  Invoke-Wsl -Command $depsCmd | Out-Null
} else {
  Write-Step ("Skipping beta runtime sync; using existing WSL runtime at " + $betaGatewayRuntimeWsl)
}

$targetUnit = @"
[Unit]
Description=Schoology Native Stack
Wants=schoology-prod-scheduler.service schoology-prod-telegram.service schoology-prod-dashboard.service schoology-beta-tool-api.service schoology-beta-gateway.service schoology-beta-monitor.service schoology-beta-dashboard.service schoology-beta-cron-sync.timer
After=network-online.target

[Install]
WantedBy=multi-user.target
"@

$prodSchedulerUnit = @"
[Unit]
Description=Schoology Prod Scheduler
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$repoWsl
EnvironmentFile=$prodEnvWsl
Environment=DATA_DIR=$repoWsl/data
Environment=AGENT_DB_PATH=$repoWsl/data/agent.db
Environment=RUNTIME_STACK=legacy
ExecStart=/usr/bin/node $repoWsl/src/scheduler.js
Restart=always
RestartSec=5
MemoryMax=350M
LimitNOFILE=65535

[Install]
WantedBy=schoology.target
"@

$prodTelegramUnit = @"
[Unit]
Description=Schoology Prod Telegram Agent
Wants=network-online.target schoology-prod-scheduler.service
After=network-online.target schoology-prod-scheduler.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$repoWsl
EnvironmentFile=$prodEnvWsl
Environment=DATA_DIR=$repoWsl/data
Environment=AGENT_DB_PATH=$repoWsl/data/agent.db
Environment=RUNTIME_STACK=legacy
ExecStart=/usr/bin/node $repoWsl/src/telegram_agent.js
Restart=always
RestartSec=5
MemoryMax=350M
LimitNOFILE=65535

[Install]
WantedBy=schoology.target
"@

$prodDashboardUnit = @"
[Unit]
Description=Schoology Prod Dashboard
Wants=network-online.target schoology-prod-scheduler.service schoology-prod-telegram.service
After=network-online.target schoology-prod-scheduler.service schoology-prod-telegram.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$repoWsl
EnvironmentFile=$prodEnvWsl
Environment=DATA_DIR=$repoWsl/data
Environment=AGENT_DB_PATH=$repoWsl/data/agent.db
Environment=RUNTIME_STACK=legacy
Environment=DASHBOARD_PORT=8787
Environment=DASHBOARD_HOST=0.0.0.0
ExecStart=/usr/bin/node $repoWsl/src/dashboard.js
Restart=always
RestartSec=5
MemoryMax=220M
LimitNOFILE=65535

[Install]
WantedBy=schoology.target
"@

$betaToolApiUnit = @"
[Unit]
Description=Schoology Beta OpenClaw Tool API
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$repoWsl
EnvironmentFile=$betaEnvWsl
Environment=DATA_DIR=$repoWsl/data/beta
Environment=AGENT_DB_PATH=$repoWsl/data/beta/agent.runtime.db
Environment=RUNTIME_STACK=openclaw
Environment=SCHOOLOGY_TOOL_API_PORT=3030
ExecStart=/usr/bin/node $repoWsl/src/openclaw_tool_api.js
Restart=always
RestartSec=5
MemoryMax=300M
LimitNOFILE=65535

[Install]
WantedBy=schoology.target
"@

$betaGatewayUnit = @"
[Unit]
Description=Schoology Beta OpenClaw Gateway
Wants=network-online.target schoology-beta-tool-api.service
After=network-online.target schoology-beta-tool-api.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$betaGatewayRuntimeWsl
EnvironmentFile=$betaEnvWsl
Environment=HOME=$stateWsl
Environment=OPENCLAW_STATE_DIR=$stateWsl
Environment=OPENCLAW_WORKSPACE_DIR=$workspaceWsl
Environment=SCHOLOGY_TOOL_API_URL=http://127.0.0.1:3030/tools/run
Environment=OPENCLAW_GATEWAY_BIND=lan
Environment=NODE_OPTIONS=--max-old-space-size=768
ExecStart=/usr/bin/node $betaGatewayRuntimeWsl/dist/index.js gateway --bind lan --port 18799 --allow-unconfigured
Restart=always
RestartSec=5
MemoryMax=1200M
LimitNOFILE=65535

[Install]
WantedBy=schoology.target
"@

$betaMonitorUnit = @"
[Unit]
Description=Schoology Beta OpenClaw Gateway Monitor
Wants=network-online.target schoology-beta-gateway.service
After=network-online.target schoology-beta-gateway.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$repoWsl
EnvironmentFile=$betaEnvWsl
Environment=DATA_DIR=$repoWsl/data/beta
Environment=RUNTIME_STACK=openclaw
Environment=OPENCLAW_GATEWAY_HOST=127.0.0.1
Environment=OPENCLAW_GATEWAY_PORT=18799
ExecStart=/usr/bin/node $repoWsl/src/openclaw_gateway_monitor.js
Restart=always
RestartSec=5
MemoryMax=150M
LimitNOFILE=65535

[Install]
WantedBy=schoology.target
"@

$betaDashboardUnit = @"
[Unit]
Description=Schoology Beta OpenClaw Dashboard
Wants=network-online.target schoology-beta-tool-api.service schoology-beta-monitor.service
After=network-online.target schoology-beta-tool-api.service schoology-beta-monitor.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$repoWsl
EnvironmentFile=$betaEnvWsl
Environment=DATA_DIR=$repoWsl/data/beta
Environment=AGENT_DB_PATH=$repoWsl/data/beta/agent.runtime.db
Environment=RUNTIME_STACK=openclaw
Environment=DASHBOARD_PORT=8788
Environment=DASHBOARD_HOST=0.0.0.0
ExecStart=/usr/bin/node $repoWsl/src/dashboard.js
Restart=always
RestartSec=5
MemoryMax=220M
LimitNOFILE=65535

[Install]
WantedBy=schoology.target
"@

$betaCronSyncUnit = @"
[Unit]
Description=Schoology Beta OpenClaw Cron Sync (oneshot bootstrap)
Wants=network-online.target schoology-beta-gateway.service
After=network-online.target schoology-beta-gateway.service

[Service]
Type=oneshot
User=root
Group=root
WorkingDirectory=$betaGatewayRuntimeWsl
EnvironmentFile=$betaEnvWsl
Environment=HOME=$stateWsl
Environment=OPENCLAW_STATE_DIR=$stateWsl
Environment=OPENCLAW_WORKSPACE_DIR=$workspaceWsl
Environment=OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18799
ExecStart=/usr/bin/node $repoWsl/scripts/openclaw_cron_sync.mjs
TimeoutStartSec=900

[Install]
WantedBy=schoology.target
"@

$betaCronSyncTimer = @"
[Unit]
Description=Run Schoology Beta OpenClaw Cron Sync every 6 hours

[Timer]
OnBootSec=90s
OnUnitActiveSec=6h
Persistent=true
Unit=schoology-beta-cron-sync.service

[Install]
WantedBy=timers.target
"@

Invoke-Wsl -Command "command -v systemctl >/dev/null 2>&1" | Out-Null
Write-SystemdEnvFile -SourcePath $prodEnvSource -TargetWslPath $prodEnvWsl
Write-SystemdEnvFile -SourcePath $betaEnvSource -TargetWslPath $betaEnvWsl
Write-SystemdUnit -UnitName "schoology.target" -Body $targetUnit
Write-SystemdUnit -UnitName "schoology-prod-scheduler.service" -Body $prodSchedulerUnit
Write-SystemdUnit -UnitName "schoology-prod-telegram.service" -Body $prodTelegramUnit
Write-SystemdUnit -UnitName "schoology-prod-dashboard.service" -Body $prodDashboardUnit
Write-SystemdUnit -UnitName "schoology-beta-tool-api.service" -Body $betaToolApiUnit
Write-SystemdUnit -UnitName "schoology-beta-gateway.service" -Body $betaGatewayUnit
Write-SystemdUnit -UnitName "schoology-beta-monitor.service" -Body $betaMonitorUnit
Write-SystemdUnit -UnitName "schoology-beta-dashboard.service" -Body $betaDashboardUnit
Write-SystemdUnit -UnitName "schoology-beta-cron-sync.service" -Body $betaCronSyncUnit
Write-SystemdUnit -UnitName "schoology-beta-cron-sync.timer" -Body $betaCronSyncTimer

Invoke-Wsl -Command "sudo systemctl daemon-reload" | Out-Null
Invoke-Wsl -Command "sudo systemctl enable schoology.target schoology-beta-cron-sync.timer" | Out-Null

if ($EnableNow) {
  Invoke-Wsl -Command "sudo systemctl start schoology.target schoology-beta-cron-sync.timer" | Out-Null
  Invoke-Wsl -Command "sudo systemctl start --no-block schoology-beta-cron-sync.service || true" | Out-Null
}

Invoke-Wsl -Command "sudo systemctl --no-pager --full status schoology.target schoology-beta-cron-sync.timer --lines=0 || true" | Out-Null
Write-Step "Done."
