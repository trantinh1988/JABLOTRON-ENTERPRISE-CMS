# Backend Jablotron CMS — USB HID that tren Windows (khong Docker).
# Chay script nay TRUOC, sau do: docker compose -f docker-compose.usb-host.yml up -d --build
#
# Docker Desktop tren Windows khong passthrough USB HID vao container.
# Kien truc dung (giong Linux): backend native tren host + UI trong Docker.

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Backend = Join-Path $Root "backend"
$DataDir = Join-Path $Backend "data"
$Keys = Join-Path $Root "keys\public_key.pem"
$Port = if ($env:CMS_BACKEND_PORT) { $env:CMS_BACKEND_PORT } else { "8010" }

Set-Location $Backend

if (-not (Test-Path $Keys)) {
    Write-Host "Chua co keys/public_key.pem. Chay tu thu muc goc:" -ForegroundColor Yellow
    Write-Host "  python admin_tool_keygen.py gen-keys --out-dir keys" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path ".venv")) {
    Write-Host "Tao virtualenv..." -ForegroundColor Cyan
    python -m venv .venv
}

& ".\.venv\Scripts\Activate.ps1"
pip install -r requirements.txt -q

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$dbFile = (Join-Path $DataDir "cms.db") -replace '\\', '/'
$env:CMS_USB_MOCK_MODE = "false"
$env:CMS_JABLOTRON_VENDOR_ID = "0x16D6"
$env:CMS_JABLOTRON_PRODUCT_ID = "0x0008"
$env:CMS_PUBLIC_KEY_PATH = $Keys
$env:CMS_DATABASE_URL = "sqlite+aiosqlite:///$dbFile"
$env:CMS_HWID_CACHE_PATH = (Join-Path $DataDir "hwid.cache")
$env:CMS_CORS_ORIGINS = "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173"

Write-Host ""
Write-Host "Backend USB HID — http://0.0.0.0:$Port" -ForegroundColor Green
Write-Host 'Terminal khac: docker compose -f docker-compose.usb-host.yml up -d --build' -ForegroundColor Cyan
Write-Host 'UI: http://127.0.0.1:8080 - cam USB Link Jablotron vao PC' -ForegroundColor Cyan
Write-Host ""

# Tranh --reload: tren Windows de de lai worker zombie, nhieu process tranh USB/port 8010.
uvicorn app.main:app --host 0.0.0.0 --port $Port
