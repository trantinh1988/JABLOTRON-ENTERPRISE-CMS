# Cai Task Scheduler: CMS tu chay khi dang nhap Windows.
# Can da deploy lan dau (co backend\.venv).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$py = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Chua co virtualenv — chay deploy-usb-windows.bat truoc." -ForegroundColor Red
    exit 1
}
$env:PYTHONPATH = Join-Path $Root "backend"
Set-Location (Join-Path $Root "backend")
& $py -c "from app.iot_core.host_autostart import set_autostart; import json; print(json.dumps(set_autostart(True), ensure_ascii=False, indent=2))"
