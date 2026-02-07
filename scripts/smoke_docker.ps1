param(
  [string]$ComposeFile = "docker-compose.yml",
  [string]$EnvFile = "",
  [string]$Project = ""
)

$ErrorActionPreference = "Stop"

$argsList = @()
if ($EnvFile -ne "") {
  $argsList += @("--env-file", $EnvFile)
}
$argsList += @("-f", $ComposeFile)
if ($Project -ne "") {
  $argsList += @("-p", $Project)
}

Write-Host "Building and starting services..." -ForegroundColor Cyan
docker compose @argsList up -d --build | Out-Host

Write-Host "Containers:" -ForegroundColor Cyan
$ps = docker compose @argsList ps
Write-Host $ps

if ($ps -match "unhealthy" -or $ps -match "Exited") {
  throw "Docker smoke test failed: unhealthy or exited container."
}

Write-Host "Recent logs (tail 80):" -ForegroundColor Cyan
docker compose @argsList logs --tail 80 | Out-Host

Write-Host "Smoke test complete." -ForegroundColor Green
