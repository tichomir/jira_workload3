$ErrorActionPreference = 'Stop'

$HealthUrl = 'http://localhost:4000/health'
$Timeout   = 60

if (-not (Test-Path '.env')) {
  Write-Warning ".env not found — copying from .env.example. Edit it before use."
  Copy-Item '.env.example' '.env'
}

Write-Host "Starting stack with podman-compose..."
podman-compose up -d
if ($LASTEXITCODE -ne 0) { Write-Error "podman-compose up failed"; exit 1 }

Write-Host "Waiting for $HealthUrl (up to ${Timeout}s)..."
$elapsed = 0
while ($true) {
  Start-Sleep -Seconds 2
  $elapsed += 2
  try {
    $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { break }
  } catch { }
  if ($elapsed -ge $Timeout) {
    Write-Error "/health did not respond within ${Timeout}s"
    exit 1
  }
}

Write-Host "Stack is healthy."
Write-Host "Open: https://localhost"
exit 0
