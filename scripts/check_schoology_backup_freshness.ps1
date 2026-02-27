param(
  [string]$StatusFile = "D:\backups\schoology\local\backup-status\last-success.json",
  [int]$MaxAgeHours = 24
)

$ErrorActionPreference = "Stop"

function Exit-With($code, $message) {
  Write-Host ("[schoology-freshness] " + $message)
  exit $code
}

if (-not (Test-Path $StatusFile)) {
  Exit-With 2 ("missing status file: " + $StatusFile)
}

try {
  $status = Get-Content -Path $StatusFile -Raw | ConvertFrom-Json
} catch {
  Exit-With 2 ("status file is not valid JSON: " + $StatusFile)
}

$stampRaw = ""
if ($status.PSObject.Properties.Name -contains "finishedAt") {
  $stampRaw = [string]$status.finishedAt
}
if ([string]::IsNullOrWhiteSpace($stampRaw)) {
  Exit-With 2 "status file missing finishedAt."
}

try {
  $finishedAt = [datetimeoffset]::Parse($stampRaw)
} catch {
  Exit-With 2 ("cannot parse finishedAt timestamp: " + $stampRaw)
}

$age = [datetimeoffset]::UtcNow - $finishedAt.ToUniversalTime()
$ageMinutes = [math]::Round($age.TotalMinutes, 1)
if ($age.TotalHours -gt $MaxAgeHours) {
  Exit-With 1 ("STALE: last successful backup is " + $ageMinutes + " minutes old.")
}

Exit-With 0 ("FRESH: last successful backup is " + $ageMinutes + " minutes old.")
