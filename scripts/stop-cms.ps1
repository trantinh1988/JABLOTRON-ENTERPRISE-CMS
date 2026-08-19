# Dung toan bo CMS tren Windows (Docker full stack + backend native).
$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PidFile = Join-Path $Root "logs\backend.pid"

Write-Host "Dung container Docker..."
docker stop jablotron-cms-backend jablotron-cms-frontend 2>$null | Out-Null
docker compose -f (Join-Path $Root "docker-compose.yml") down --remove-orphans 2>$null | Out-Null
docker compose -f (Join-Path $Root "docker-compose.all-in-docker.yml") down --remove-orphans 2>$null | Out-Null
docker compose -f (Join-Path $Root "docker-compose.usb-host.yml") down --remove-orphans 2>$null | Out-Null
docker compose -f (Join-Path $Root "docker-compose.usb-host.linux.yml") down --remove-orphans 2>$null | Out-Null

if (Test-Path $PidFile) {
    $oldPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'uvicorn app\.main:app' } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Write-Host "Da dung."
