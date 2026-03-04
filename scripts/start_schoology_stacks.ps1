param(
  [string]$RepoRoot = "",
  [ValidateSet("native", "docker")][string]$RuntimeMode = "docker",
  [string]$WslDistro = "Ubuntu-24.04",
  [string]$ProdProject = "schoology-prod",
  [string]$BetaProject = "schoology-openclaw-beta",
  [int]$DockerReadyTimeoutSeconds = 180,
  [int]$DockerReadyRetrySeconds = 5,
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

function Get-ModelProviderFromReference([string]$ModelReference, [string]$DefaultProvider = "openai") {
  if ([string]::IsNullOrWhiteSpace($ModelReference)) {
    return $DefaultProvider.ToLowerInvariant()
  }
  $parts = $ModelReference.Split("/", 2)
  $provider = ""
  if ($parts.Count -gt 0) {
    $provider = $parts[0].Trim().ToLowerInvariant()
  }
  if ([string]::IsNullOrWhiteSpace($provider)) {
    return $DefaultProvider.ToLowerInvariant()
  }
  return $provider
}

function Get-BetaPrimaryModelReference([string]$RepoRootPath, [string]$DefaultModelReference = "openai/gpt-5.2") {
  $configPath = Join-Path $RepoRootPath "data\openclaw-beta\openclaw.json"
  if (-not (Test-Path $configPath)) {
    return $DefaultModelReference
  }
  $candidate = ""
  try {
    $config = Get-Content -Raw $configPath | ConvertFrom-Json
    if ($config -and $config.agents -and $config.agents.defaults -and $config.agents.defaults.model) {
      $modelNode = $config.agents.defaults.model
      if ($modelNode -is [string]) {
        $candidate = [string]$modelNode
      } elseif ($modelNode.PSObject.Properties.Name -contains "primary") {
        $candidate = [string]$modelNode.primary
      }
    }
  } catch {
    Write-Step ("WARNING: failed reading beta model config at " + $configPath + ": " + $_.Exception.Message)
    return $DefaultModelReference
  }
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    return $DefaultModelReference
  }
  return $candidate.Trim()
}

function Get-TelegramGroupChatIdsFromEnv([hashtable]$EnvMap) {
  if (-not $EnvMap -or -not $EnvMap.ContainsKey("TELEGRAM_CHAT_IDS")) {
    return @()
  }
  $raw = [string]$EnvMap["TELEGRAM_CHAT_IDS"]
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @()
  }
  return @(
    $raw -split "[,;\s]+" |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -match "^-?\d+$" -and $_.StartsWith("-") } |
      Select-Object -Unique
  )
}

function Ensure-BetaGatewayMode([string]$RepoRootPath, [string]$Mode = "local") {
  if ($DryRun -or $SkipBeta) {
    return
  }
  $configPath = Join-Path $RepoRootPath "data\openclaw-beta\openclaw.json"
  $targetMode = if ([string]::IsNullOrWhiteSpace($Mode)) { "local" } else { $Mode.Trim().ToLowerInvariant() }

  $config = $null
  if (Test-Path $configPath) {
    try {
      $config = Get-Content -Raw $configPath | ConvertFrom-Json
    } catch {
      throw ("Failed to parse beta OpenClaw config at " + $configPath + ": " + $_.Exception.Message)
    }
  } else {
    $config = [pscustomobject]@{}
  }

  $gatewayConfig = $null
  if ($config.PSObject.Properties.Name -contains "gateway" -and $config.gateway) {
    $gatewayConfig = $config.gateway
  } else {
    $gatewayConfig = [pscustomobject]@{}
    $config | Add-Member -NotePropertyName "gateway" -NotePropertyValue $gatewayConfig -Force
  }

  $currentMode = ""
  if ($gatewayConfig.PSObject.Properties.Name -contains "mode" -and $gatewayConfig.mode) {
    $currentMode = ([string]$gatewayConfig.mode).Trim()
  }
  if (-not [string]::IsNullOrWhiteSpace($currentMode)) {
    Write-Step ("Beta gateway mode already configured: " + $currentMode)
    return
  }

  $gatewayConfig | Add-Member -NotePropertyName "mode" -NotePropertyValue $targetMode -Force
  ($config | ConvertTo-Json -Depth 20) | Set-Content -Path $configPath -Encoding UTF8
  Write-Step ("Set beta OpenClaw gateway.mode to '" + $targetMode + "' in " + $configPath)
}

function Ensure-BetaTelegramGroupPolicy([string]$RepoRootPath, [hashtable]$BetaEnvMap) {
  if ($DryRun -or $SkipBeta) {
    return
  }

  $targetGroupIds = Get-TelegramGroupChatIdsFromEnv -EnvMap $BetaEnvMap
  if ($targetGroupIds.Count -eq 0) {
    Write-Step "WARNING: TELEGRAM_CHAT_IDS has no group chat IDs; skipped beta Telegram groupPolicy hardening."
    return
  }

  $configPath = Join-Path $RepoRootPath "data\openclaw-beta\openclaw.json"
  $config = $null
  if (Test-Path $configPath) {
    try {
      $config = Get-Content -Raw $configPath | ConvertFrom-Json
    } catch {
      throw ("Failed to parse beta OpenClaw config at " + $configPath + ": " + $_.Exception.Message)
    }
  } else {
    $config = [pscustomobject]@{}
  }

  $channelsConfig = $null
  if ($config.PSObject.Properties.Name -contains "channels" -and $config.channels) {
    $channelsConfig = $config.channels
  } else {
    $channelsConfig = [pscustomobject]@{}
    $config | Add-Member -NotePropertyName "channels" -NotePropertyValue $channelsConfig -Force
  }

  $telegramConfig = $null
  if ($channelsConfig.PSObject.Properties.Name -contains "telegram" -and $channelsConfig.telegram) {
    $telegramConfig = $channelsConfig.telegram
  } else {
    $telegramConfig = [pscustomobject]@{}
    $channelsConfig | Add-Member -NotePropertyName "telegram" -NotePropertyValue $telegramConfig -Force
  }

  $groupsConfig = $null
  if ($telegramConfig.PSObject.Properties.Name -contains "groups" -and $telegramConfig.groups) {
    $groupsConfig = $telegramConfig.groups
  } else {
    $groupsConfig = [pscustomobject]@{}
    $telegramConfig | Add-Member -NotePropertyName "groups" -NotePropertyValue $groupsConfig -Force
  }

  $changed = $false
  foreach ($groupId in $targetGroupIds) {
    $groupConfig = $null
    if ($groupsConfig.PSObject.Properties.Name -contains $groupId -and $groupsConfig.$groupId) {
      $groupConfig = $groupsConfig.$groupId
    } else {
      $groupConfig = [pscustomobject]@{}
      $groupsConfig | Add-Member -NotePropertyName $groupId -NotePropertyValue $groupConfig -Force
      $changed = $true
    }

    $currentPolicy = ""
    if ($groupConfig.PSObject.Properties.Name -contains "groupPolicy" -and $groupConfig.groupPolicy) {
      $currentPolicy = ([string]$groupConfig.groupPolicy).Trim().ToLowerInvariant()
    }
    if ($currentPolicy -ne "open") {
      $groupConfig | Add-Member -NotePropertyName "groupPolicy" -NotePropertyValue "open" -Force
      $changed = $true
      Write-Step ("Set beta Telegram groupPolicy=open for chat " + $groupId + ".")
    }

    if (-not ($groupConfig.PSObject.Properties.Name -contains "requireMention")) {
      $groupConfig | Add-Member -NotePropertyName "requireMention" -NotePropertyValue $false -Force
      $changed = $true
    }
  }

  if ($changed) {
    ($config | ConvertTo-Json -Depth 20) | Set-Content -Path $configPath -Encoding UTF8
    Write-Step ("Updated beta Telegram group policy in " + $configPath)
  } else {
    Write-Step "Beta Telegram group policy already open for configured group chat IDs."
  }
}

function Ensure-BetaAuthBootstrap([string]$RepoRootPath, [string]$RequiredProvider, [hashtable]$BetaEnvMap, [switch]$Required) {
  if ($DryRun -or $SkipBeta) {
    return $true
  }
  $provider = if ([string]::IsNullOrWhiteSpace($RequiredProvider)) { "openai" } else { $RequiredProvider.Trim().ToLowerInvariant() }
  $agentDir = Join-Path $RepoRootPath "data\openclaw-beta\agents\main\agent"
  $authStorePath = Join-Path $agentDir "auth-profiles.json"

  if (-not (Test-Path $agentDir)) {
    if ($DryRun) {
      Write-Step ("DRY RUN: create beta agent dir " + $agentDir)
    } else {
      New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
    }
  }

  if (Test-Path $authStorePath) {
    Write-Step ("Beta auth store already present: " + $authStorePath)
    return $true
  }

  $profiles = [ordered]@{}
  if ($provider -eq "openai") {
    $openaiKey = ""
    if ($BetaEnvMap -and $BetaEnvMap.ContainsKey("OPENAI_API_KEY")) {
      $openaiKey = ([string]$BetaEnvMap["OPENAI_API_KEY"]).Trim()
    }
    if ([string]::IsNullOrWhiteSpace($openaiKey)) {
      if ($Required) {
        throw "Configured beta provider is openai but OPENAI_API_KEY is missing in .env.beta; cannot bootstrap auth-profiles.json."
      }
      Write-Step "WARNING: OPENAI_API_KEY missing in .env.beta; beta auth bootstrap skipped."
      return $false
    }
    $profiles["openai:default"] = [ordered]@{
      type = "api_key"
      provider = "openai"
      key = $openaiKey
    }
  }

  $payload = [ordered]@{
    version = 1
    profiles = $profiles
  }

  if ($DryRun) {
    Write-Step ("DRY RUN: create beta auth store " + $authStorePath)
    return $true
  }
  ($payload | ConvertTo-Json -Depth 8) | Set-Content -Path $authStorePath -Encoding UTF8
  Write-Step ("Bootstrapped beta auth store at " + $authStorePath + " for provider " + $provider + ".")
  return $true
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

function Invoke-Docker([string[]]$DockerArgs, [switch]$Quiet) {
  $display = "docker " + ($DockerArgs -join " ")
  if ($DryRun) {
    if (-not $Quiet) {
      Write-Step ("DRY RUN: " + $display)
    }
    return ""
  }
  if (-not $Quiet) {
    Write-Step ("Running: " + $display)
  }
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
  if ($output -and -not $Quiet) {
    $output | Out-Host
  }
  return ($output -join "`n")
}

function Get-DockerEngineDiagnostics([string]$LastErrorMessage) {
  $parts = @()
  try {
    $dockerExe = Get-DockerCommandPath
    $parts += ("dockerExe=" + $dockerExe)
  } catch {
    $parts += ("dockerExeMissing=" + $_.Exception.Message)
  }

  $service = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
  if ($service) {
    $parts += ("dockerServiceStatus=" + $service.Status)
    $parts += ("dockerServiceStartType=" + $service.StartType)
  } else {
    $parts += "dockerServiceStatus=not-found"
  }

  $processes = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like "Docker*" } |
    Select-Object -ExpandProperty ProcessName -Unique
  if ($processes) {
    $parts += ("dockerProcesses=" + ($processes -join ","))
  } else {
    $parts += "dockerProcesses=none"
  }

  if (-not [string]::IsNullOrWhiteSpace($LastErrorMessage)) {
    $headline = ($LastErrorMessage -split "`r?`n" | Select-Object -First 1)
    $parts += ("lastError=" + $headline)
  }

  return ($parts -join "; ")
}

function Wait-DockerEngineReady(
  [int]$TimeoutSeconds,
  [int]$RetrySeconds
) {
  if ($DryRun) {
    Write-Step ("DRY RUN: wait for Docker engine readiness timeout=" + $TimeoutSeconds + "s retry=" + $RetrySeconds + "s")
    return
  }

  $timeout = [Math]::Max(1, $TimeoutSeconds)
  $retry = [Math]::Max(1, $RetrySeconds)
  $deadline = (Get-Date).AddSeconds($timeout)
  $attempt = 0
  $lastError = ""
  while ((Get-Date) -lt $deadline) {
    $attempt++
    try {
      $versionRaw = Invoke-Docker -DockerArgs @("version", "--format", "{{.Server.Version}}") -Quiet
      $serverVersion = ($versionRaw -split "`r?`n" | Select-Object -First 1).Trim()
      if ([string]::IsNullOrWhiteSpace($serverVersion)) {
        $serverVersion = "unknown"
      }
      Write-Step ("Docker engine ready (attempt " + $attempt + ", serverVersion=" + $serverVersion + ").")
      return
    } catch {
      $lastError = $_.Exception.Message
      $headline = ($lastError -split "`r?`n" | Select-Object -First 1)
      Write-Step ("Waiting for Docker engine (attempt " + $attempt + "): " + $headline)
      Start-Sleep -Seconds $retry
    }
  }

  $diagnostics = Get-DockerEngineDiagnostics -LastErrorMessage $lastError
  throw ("Docker engine was not ready within " + $timeout + " seconds. Diagnostics: " + $diagnostics)
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

function Test-LocalPortListening([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -First 1
  return ($null -ne $listener)
}

function Wait-LocalPortListening([int]$Port, [int]$TimeoutSeconds, [string]$Label, [switch]$Required) {
  if ($DryRun) {
    Write-Step ("DRY RUN: wait for " + $Label + " on port " + $Port)
    return $true
  }
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPortListening -Port $Port) {
      Write-Step ($Label + " listening on port " + $Port + ".")
      return $true
    }
    Start-Sleep -Seconds 2
  }
  if ($Required) {
    throw ($Label + " did not start listening on port " + $Port + " within " + $TimeoutSeconds + " seconds.")
  }
  Write-Step ("WARNING: " + $Label + " is not listening on port " + $Port + " after " + $TimeoutSeconds + " seconds.")
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

function Wait-DockerComposeLogPattern(
  [string]$ComposeFile,
  [string]$EnvFile,
  [string]$ProjectName,
  [string]$ServiceName,
  [string]$Pattern,
  [int]$TimeoutSeconds,
  [switch]$Required
) {
  if ($DryRun) {
    Write-Step ("DRY RUN: wait for docker log pattern in " + $ServiceName + ": " + $Pattern)
    return $true
  }
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
  while ((Get-Date) -lt $deadline) {
    try {
      $raw = Invoke-Docker -DockerArgs @(
        "compose",
        "--env-file",
        $EnvFile,
        "-f",
        $ComposeFile,
        "-p",
        $ProjectName,
        "logs",
        "--no-color",
        "--tail",
        "250",
        $ServiceName
      ) -Quiet
      if (-not [string]::IsNullOrWhiteSpace($raw) -and $raw.Contains($Pattern)) {
        Write-Step ("Found docker readiness pattern for " + $ServiceName + ": " + $Pattern)
        return $true
      }
    } catch {
      # Ignore transient log-read failures while service settles.
    }
    Start-Sleep -Seconds 3
  }
  if ($Required) {
    throw ("Did not observe readiness pattern for " + $ServiceName + " within " + $TimeoutSeconds + " seconds: " + $Pattern)
  }
  Write-Step ("WARNING: readiness pattern not observed for " + $ServiceName + ": " + $Pattern)
  return $false
}

function Invoke-DockerWithRetry(
  [string[]]$DockerArgs,
  [int]$MaxAttempts = 8,
  [int]$DelaySeconds = 4,
  [string]$OperationLabel = "docker command"
) {
  $attempt = 1
  while ($attempt -le [Math]::Max(1, $MaxAttempts)) {
    try {
      return Invoke-Docker -DockerArgs $DockerArgs -Quiet
    } catch {
      if ($attempt -ge $MaxAttempts) {
        throw
      }
      Write-Step ("WARNING: " + $OperationLabel + " failed (attempt " + $attempt + "/" + $MaxAttempts + "). Retrying in " + $DelaySeconds + "s.")
      Start-Sleep -Seconds ([Math]::Max(1, $DelaySeconds))
    }
    $attempt++
  }
  return ""
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

function Assert-HttpHealth([string]$Url, [string]$Label, [int]$TimeoutSeconds = 180, [int]$IntervalSeconds = 3) {
  if ($DryRun) {
    Write-Step ("DRY RUN: health check " + $Url)
    return
  }
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
  $lastError = ""
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod $Url -TimeoutSec 8
      Write-Step ("$Label health ok: " + ($response | ConvertTo-Json -Compress))
      return
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds ([Math]::Max(1, $IntervalSeconds))
    }
  }
  throw "$Label health check failed at ${Url} within $TimeoutSeconds seconds: $lastError"
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

function Assert-BetaModelAuthHealthy(
  [string]$RepoRootPath,
  [ValidateSet("native", "docker")][string]$RuntimeModeValue,
  [string]$BetaProjectName,
  [string]$RequiredProvider,
  [switch]$Required
) {
  if ($DryRun -or $SkipBeta) {
    return $true
  }

  $provider = if ([string]::IsNullOrWhiteSpace($RequiredProvider)) { "openai" } else { $RequiredProvider.Trim().ToLowerInvariant() }
  $raw = ""
  if ($RuntimeModeValue -eq "docker") {
    $raw = Invoke-Docker -DockerArgs @(
      "compose",
      "--env-file",
      ".env.beta",
      "-f",
      "docker-compose.beta-openclaw.yml",
      "-p",
      $BetaProjectName,
      "exec",
      "-T",
      "openclaw-gateway",
      "node",
      "dist/index.js",
      "models",
      "status",
      "--json"
    ) -Quiet
  } else {
    $repoWsl = Convert-WindowsPathToWsl -WindowsPath $RepoRootPath
    $stateWsl = "$repoWsl/data/openclaw-beta"
    $workspaceWsl = "$repoWsl/openclaw_workspace"
    $vendorWsl = "$repoWsl/vendor/openclaw"
    $envFileSystemdWsl = "$repoWsl/.env.beta.systemd"
    $envFileWsl = "$repoWsl/.env.beta"
    $escapedEnvSystemd = Escape-BashSingleQuote $envFileSystemdWsl
    $escapedEnv = Escape-BashSingleQuote $envFileWsl
    $escapedVendor = Escape-BashSingleQuote $vendorWsl
    $escapedState = Escape-BashSingleQuote $stateWsl
    $escapedWorkspace = Escape-BashSingleQuote $workspaceWsl
    $cmd = @(
      "if [ -f '$escapedEnvSystemd' ]; then set -a; source '$escapedEnvSystemd' 2>/dev/null || true; set +a; elif [ -f '$escapedEnv' ]; then set -a; source '$escapedEnv' 2>/dev/null || true; set +a; fi",
      "cd '$escapedVendor'",
      "OPENCLAW_STATE_DIR='$escapedState' OPENCLAW_WORKSPACE_DIR='$escapedWorkspace' HOME='$escapedState' node dist/index.js models status --json"
    ) -join "; "
    $raw = Invoke-Wsl -Command $cmd -Quiet
  }

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
    $missingProviders = @(
      $status.auth.missingProvidersInUse |
      ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Sort-Object -Unique
    )
  }
  if ($missingProviders -contains $provider) {
    if ($Required) {
      throw ("Beta model auth missing required provider " + $provider + " for configured primary model.")
    }
    Write-Step ("WARNING: Beta model auth missing required provider " + $provider + ".")
    return $false
  }

  if ($missingProviders.Count -gt 0) {
    Write-Step ("Beta model auth check passed for required provider " + $provider + "; other missing providers: " + ($missingProviders -join ",") + ".")
  } else {
    Write-Step ("Beta model auth check passed for required provider " + $provider + ".")
  }
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

$betaPrimaryModelReference = Get-BetaPrimaryModelReference -RepoRootPath $RepoRoot
$betaPrimaryProvider = Get-ModelProviderFromReference -ModelReference $betaPrimaryModelReference
Write-Step ("Beta primary model configured: " + $betaPrimaryModelReference + " (provider=" + $betaPrimaryProvider + ").")
if (-not $SkipBeta) {
  Ensure-BetaGatewayMode -RepoRootPath $RepoRoot -Mode "local"
  Ensure-BetaTelegramGroupPolicy -RepoRootPath $RepoRoot -BetaEnvMap $betaEnv
  $null = Ensure-BetaAuthBootstrap -RepoRootPath $RepoRoot -RequiredProvider $betaPrimaryProvider -BetaEnvMap $betaEnv -Required
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
      $null = Assert-BetaModelAuthHealthy -RepoRootPath $RepoRoot -RuntimeModeValue "native" -BetaProjectName $BetaProject -RequiredProvider $betaPrimaryProvider -Required
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
if (-not $SkipProd -or -not $SkipBeta) {
  Wait-DockerEngineReady -TimeoutSeconds $DockerReadyTimeoutSeconds -RetrySeconds $DockerReadyRetrySeconds
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

  if (-not $DryRun) {
    $null = Wait-LocalPortListening -Port 18799 -TimeoutSeconds 180 -Label "Schoology OpenClaw gateway (docker pre-bootstrap)" -Required
  }

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
  try {
    Invoke-DockerWithRetry -DockerArgs $bootstrapArgs -MaxAttempts 10 -DelaySeconds 5 -OperationLabel "Schoology beta cron bootstrap command" | Out-Null
  } catch {
    Write-Step ("WARNING: beta cron bootstrap command failed after retries; continuing startup. " + $_.Exception.Message)
  }

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

if (-not $DryRun) {
  if (-not $SkipBeta) {
    $null = Wait-LocalPortListening -Port 18799 -TimeoutSeconds 300 -Label "Schoology OpenClaw gateway (docker)" -Required
    $null = Wait-DockerComposeLogPattern -ComposeFile "docker-compose.beta-openclaw.yml" -EnvFile ".env.beta" -ProjectName $BetaProject -ServiceName "openclaw-gateway" -Pattern "starting provider (@schoology_beta_bot)" -TimeoutSeconds 240 -Required
    $bridgeReady = Wait-LocalPortListening -Port 18800 -TimeoutSeconds 30 -Label "Schoology reserved beta bridge/derived port (docker)"
    if (-not $bridgeReady) {
      Write-Step "INFO: port 18800 is reserved for Schoology coexistence but may be unused on current OpenClaw builds."
    }
    $null = Assert-BetaModelAuthHealthy -RepoRootPath $RepoRoot -RuntimeModeValue "docker" -BetaProjectName $BetaProject -RequiredProvider $betaPrimaryProvider -Required
  }

  if (-not $SkipProd) {
    Assert-HttpHealth -Url "http://127.0.0.1:8787/api/health" -Label "Prod dashboard"
  }
  if (-not $SkipBeta -and -not $SkipBetaDashboard) {
    Assert-HttpHealth -Url "http://127.0.0.1:8788/api/health" -Label "Beta dashboard"
  }
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
