param(
  [string]$RepoRoot = "",
  [ValidateSet("docker")][string]$RuntimeMode = "docker",
  [string]$WslDistro = "",
  [string]$ProdProject = "schoology-prod",
  [int]$DockerReadyTimeoutSeconds = 180,
  [int]$DockerReadyRetrySeconds = 5,
  [switch]$NoBuild,
  [switch]$SkipProd,
  [switch]$SkipPortCheck,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ("[start-stacks] " + $message)
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

function Wait-DockerEngineReady([int]$TimeoutSeconds, [int]$RetrySeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = ""
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-Docker -DockerArgs @("info", "--format", "{{.ServerVersion}}") | Out-Null
      Write-Step "Docker engine is ready."
      return
    } catch {
      $lastError = $_.Exception.Message
      Write-Step ("Docker not ready yet; retrying in " + $RetrySeconds + "s.")
      Start-Sleep -Seconds $RetrySeconds
    }
  }
  throw "Docker engine did not become ready within $TimeoutSeconds seconds. Last error: $lastError"
}

function Assert-HttpHealth([string]$Url, [string]$Label) {
  if ($DryRun) {
    Write-Step ("DRY RUN: health check " + $Label + " " + $Url)
    return
  }
  try {
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 10
    Write-Step ($Label + " health ok: " + ($response | ConvertTo-Json -Compress))
  } catch {
    throw ($Label + " health check failed at " + $Url + ": " + $_.Exception.Message)
  }
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path $RepoRoot).Path
Set-Location $RepoRoot

if (-not (Test-Path "docker-compose.yml")) {
  throw "Missing docker-compose.yml in $RepoRoot"
}

if ($RuntimeMode -ne "docker") {
  throw "Only Docker runtime mode is supported."
}

if (-not $SkipProd) {
  Wait-DockerEngineReady -TimeoutSeconds $DockerReadyTimeoutSeconds -RetrySeconds $DockerReadyRetrySeconds

  $prodUp = @("compose", "-f", "docker-compose.yml", "-p", $ProdProject, "up", "-d")
  if (-not $NoBuild) {
    $prodUp += "--build"
  }
  Invoke-Docker -DockerArgs $prodUp | Out-Null

  if (-not $SkipPortCheck) {
    Assert-HttpHealth -Url "http://127.0.0.1:8787/api/health" -Label "Prod dashboard"
  }

  Invoke-Docker -DockerArgs @("compose", "-f", "docker-compose.yml", "-p", $ProdProject, "ps") | Out-Null
} else {
  Write-Step "SkipProd requested; no services started."
}

Write-Step "Done."
