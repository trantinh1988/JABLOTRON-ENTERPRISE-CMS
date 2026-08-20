# Trien khai CMS voi USB that tren Windows:
#   - Backend native tren host (port 8010) — HID qua hidapi
#   - Frontend trong Docker (port 8080) — proxy toi host.docker.internal:8010
#
# Docker Desktop KHONG passthrough USB HID vao container Windows.
# Backend native tren host + UI trong Docker.
#
# Chay: .\scripts\deploy-usb-windows.ps1
# Yeu cau: Docker Desktop dang chay, Python 3, keys/public_key.pem

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Backend = Join-Path $Root "backend"
$LogDir = Join-Path $Root "logs"
$PidFile = Join-Path $LogDir "backend.pid"
$DataDir = Join-Path $Backend "data"
$Keys = Join-Path $Root "keys\public_key.pem"
$Port = if ($env:CMS_BACKEND_PORT) { $env:CMS_BACKEND_PORT } else { "8010" }
$UiPort = if ($env:CMS_UI_PORT) { $env:CMS_UI_PORT } else { "8080" }

Set-Location $Root
New-Item -ItemType Directory -Force -Path $LogDir, $DataDir | Out-Null
$portsFile = Join-Path $DataDir "host_ports.json"
if (Test-Path $portsFile) {
    try {
        $pj = Get-Content $portsFile -Raw | ConvertFrom-Json
        if ($pj.ui_port) { $UiPort = [string]$pj.ui_port }
        if ($pj.api_port) { $Port = [string]$pj.api_port }
    } catch {}
}
$env:CMS_UI_PORT = $UiPort
$env:CMS_BACKEND_PORT = $Port
$nginxRuntime = Join-Path $DataDir "nginx-ui.conf"
if (Test-Path $nginxRuntime -PathType Container) {
    Remove-Item $nginxRuntime -Recurse -Force
}
# Luôn ghi lại nginx Windows (listen 80 + host.docker.internal).
Copy-Item (Join-Path $Root "frontend\nginx.host-backend.conf") $nginxRuntime -Force
$ensurePy = Join-Path $Backend ".venv\Scripts\python.exe"
if (Test-Path $ensurePy) {
    Push-Location $Backend
    & $ensurePy -c "from app.iot_core.host_ports import ensure_runtime_files; ensure_runtime_files()" 2>$null
    Pop-Location
}

if (-not (Test-Path $Keys)) {
    Write-Host "Thieu keys/public_key.pem" -ForegroundColor Red
    Write-Host "  python admin_tool_keygen.py gen-keys --out-dir keys"
    exit 1
}

Write-Host "=== 1. Dung Docker backend - container khong dung duoc USB HID tren Windows ==="
& "$PSScriptRoot\stop-cms.ps1"

Write-Host ""
Write-Host "=== 2. Kiem tra HID tren host ==="
$pnp = Get-PnpDevice -ErrorAction SilentlyContinue |
    Where-Object { $_.Class -in @('USB', 'HIDClass') -and $_.InstanceId -match 'VID_16D6' }
if (-not $pnp) {
    Write-Host "Cam USB Link Jablotron roi chay lai." -ForegroundColor Yellow
    exit 1
}
$pnp | Select-Object Status, FriendlyName, InstanceId | Format-Table -AutoSize

Write-Host ""
Write-Host "=== 3. Chuan bi backend native ==="
Set-Location $Backend
if (-not (Test-Path ".venv")) {
    Write-Host "Tao virtualenv..." -ForegroundColor Cyan
    python -m venv .venv
}
& ".\.venv\Scripts\Activate.ps1"
pip install -r requirements.txt -q

$hidScript = Join-Path $LogDir "check_hid.py"
@'
import hid
n = len(hid.enumerate(0x16D6, 0x0008))
print("hid.enumerate(16D6,0008) -> %d thiet bi" % n)
if n == 0:
    all16 = [d for d in hid.enumerate(0, 0) if d.get("vendor_id") == 0x16D6]
    print("fallback enumerate -> %d thiet bi" % len(all16))
    if not all16:
        raise SystemExit(1)
'@ | Set-Content -Path $hidScript -Encoding UTF8
$hidCheck = & ".\.venv\Scripts\python.exe" $hidScript 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "hidapi khong thay Jablotron - kiem tra cap USB / driver Windows." -ForegroundColor Red
    Write-Host $hidCheck
    exit 1
}
Write-Host $hidCheck
Remove-Item $hidScript -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== 4. Dung backend cu neu co ==="
if (Test-Path $PidFile) {
    $oldPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'uvicorn app\.main:app' } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Seconds 1

$dbFile = (Join-Path $DataDir "cms.db") -replace '\\', '/'
$env:CMS_USB_MOCK_MODE = "false"
$env:CMS_JABLOTRON_VENDOR_ID = "0x16D6"
$env:CMS_JABLOTRON_PRODUCT_ID = "0x0008"
$env:CMS_PUBLIC_KEY_PATH = $Keys
$env:CMS_DATABASE_URL = "sqlite+aiosqlite:///$dbFile"
$env:CMS_HWID_CACHE_PATH = (Join-Path $DataDir "hwid.cache")
$env:CMS_CORS_ORIGINS = "http://localhost:$UiPort,http://127.0.0.1:$UiPort,http://localhost:5173,http://127.0.0.1:5173"

Write-Host ""
Write-Host ("=== 5. Khoi dong backend USB nen, port {0} ===" -f $Port)
$logFile = Join-Path $LogDir "backend.log"
$errFile = Join-Path $LogDir "backend.err.log"
$python = Join-Path $Backend ".venv\Scripts\python.exe"
if (Test-Path $logFile) { Remove-Item $logFile -Force -ErrorAction SilentlyContinue }
if (Test-Path $errFile) { Remove-Item $errFile -Force -ErrorAction SilentlyContinue }
$proc = Start-Process -FilePath $python `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$Port") `
    -WorkingDirectory $Backend `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errFile `
    -WindowStyle Hidden `
    -PassThru
$proc.Id | Set-Content -Path $PidFile -Encoding ascii
Start-Sleep -Seconds 4

try {
    $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 5
    if ($health.status -ne "ok") { throw "health not ok" }
} catch {
    Write-Host ("Backend chua san sang tren :{0} - xem log:" -f $Port) -ForegroundColor Red
    if (Test-Path $errFile) { Get-Content $errFile -Tail 30 }
    elseif (Test-Path $logFile) { Get-Content $logFile -Tail 30 }
    exit 1
}

$usbJson = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/usb/status" -f $Port) -TimeoutSec 5
$hint = [string]$usbJson.hint
if ($hint -match 'Docker') {
    Write-Host ("Loi: :{0} van tro vao Docker - chay: .\scripts\stop-cms.ps1" -f $Port) -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host ("=== 6. Khoi dong UI Docker proxy host.docker.internal:{0} ===" -f $Port)
Set-Location $Root
docker compose -f docker-compose.usb-host.yml up -d --build --force-recreate --remove-orphans
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker compose that bai - dam bao Docker Desktop dang chay." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== 7. Kiem tra USB ==="
& "$PSScriptRoot\check-usb-windows.ps1"

Write-Host ""
Write-Host "Xong."
Write-Host ("  UI:      http://127.0.0.1:{0}" -f $UiPort)
Write-Host ("  API:     http://127.0.0.1:{0}/api/usb/status" -f $Port)
Write-Host ("  App:     .\\scripts\\start-cms-desktop.ps1  (khong bat buoc Docker)")
Write-Host ("  Log:     Get-Content {0} -Wait -Tail 50" -f $logFile)
Write-Host "  Dung:    .\scripts\stop-cms.ps1"
Write-Host "  Autostart: bat «Khoi dong cung may» tren trang He thong"
Write-Host "             hoac .\scripts\install-autostart-windows.ps1"
