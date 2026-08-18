# Kiem tra USB Jablotron tren Windows + API backend.
# Chay: .\scripts\check-usb-windows.ps1
$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Backend = Join-Path $Root "backend"
$Port = if ($env:CMS_BACKEND_PORT) { $env:CMS_BACKEND_PORT } else { "8010" }
$HostUsb = $false

Write-Host "=== 1. Host: PnP USB VID 16D6 ==="
$pnp = Get-PnpDevice -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Class -in @('USB', 'HIDClass') -and (
            $_.InstanceId -match 'VID_16D6' -or $_.FriendlyName -match 'Jablotron|16D6'
        )
    }
if ($pnp) {
    $HostUsb = $true
    $pnp | Select-Object Status, Class, FriendlyName, InstanceId | Format-Table -AutoSize
} else {
    Write-Host "khong thay VID 16D6 - cam USB Link Jablotron"
}

Write-Host ""
Write-Host "=== 2. Host: hidapi enumerate ==="
$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    $hidScript = Join-Path $Root "logs\check_hid.py"
    New-Item -ItemType Directory -Force -Path (Split-Path $hidScript) | Out-Null
    @'
import hid
n = len(hid.enumerate(0x16D6, 0x0008))
print("hid.enumerate(16D6,0008) -> %d thiet bi" % n)
if n == 0:
    all16 = [d for d in hid.enumerate(0, 0) if d.get("vendor_id") == 0x16D6]
    print("fallback enumerate -> %d thiet bi" % len(all16))
'@ | Set-Content -Path $hidScript -Encoding UTF8
    & $venvPython $hidScript
    if ($LASTEXITCODE -eq 0) { $HostUsb = $true }
    Remove-Item $hidScript -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "chua co venv - chay: .\scripts\deploy-usb-windows.ps1"
}

Write-Host ""
Write-Host "=== 3. Backend dang chay o dau? ==="
$backendContainer = docker ps --format '{{.Names}}' 2>$null | Select-String -Pattern '^jablotron-cms-backend$'
if ($backendContainer) {
    Write-Host "  ! Container jablotron-cms-backend van chay - USB HID khong hoat dong trong Docker Windows"
    Write-Host "    Dung: .\scripts\stop-cms.ps1"
} else {
    try {
        $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 3
        if ($health.status -eq "ok") {
            Write-Host ("  OK Backend native :{0} - dung cho USB" -f $Port)
        }
    } catch {
        Write-Host "  X Chua co backend native - chay: .\scripts\deploy-usb-windows.ps1"
    }
}

Write-Host ""
Write-Host ("=== 4. API native :{0} ===" -f $Port)
$native = $null
try {
    $native = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/usb/status" -f $Port) -TimeoutSec 5
    $native | ConvertTo-Json -Depth 6
} catch {
    Write-Host ("  khong phan hoi - backend native chua chay tren port {0}" -f $Port)
}

Write-Host ""
Write-Host "=== 5. API UI :8080 ==="
try {
    $ui = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/usb/status" -TimeoutSec 5
    $ui | ConvertTo-Json -Depth 6
} catch {
    Write-Host "  UI chua chay hoac proxy loi - chay lai: .\scripts\deploy-usb-windows.ps1"
}

Write-Host ""
Write-Host "=== Goi y ==="
if ($backendContainer) {
    Write-Host "Dang chay SAI che do - backend trong Docker. Chay:"
    Write-Host "  .\scripts\stop-cms.ps1"
    Write-Host "  .\scripts\deploy-usb-windows.ps1"
} elseif (-not $native) {
    if ($HostUsb) {
        Write-Host "USB da cam nhung backend native chua chay:"
        Write-Host "  .\scripts\deploy-usb-windows.ps1"
    } else {
        Write-Host "Cam USB Link Jablotron, roi: .\scripts\deploy-usb-windows.ps1"
    }
} else {
    Write-Host ("OK - dung http://127.0.0.1:8080 UI hoac http://127.0.0.1:{0} API" -f $Port)
}
