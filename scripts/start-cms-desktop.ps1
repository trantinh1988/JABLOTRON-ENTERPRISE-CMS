# App Windows: backend native + cua so CMS (khong bat buoc Docker).
# Chay: .\scripts\start-cms-desktop.ps1
#
# Build UI dist, restart backend (API logo/khoa), rebuild Docker frontend neu co.

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = Resolve-Path (Join-Path $PSScriptRoot "..") }
$Backend = Join-Path $Root "backend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
$PythonW = Join-Path $Backend ".venv\Scripts\pythonw.exe"
$Shell = Join-Path $Root "desktop\cms_shell.py"
$DeskReq = Join-Path $Root "desktop\requirements.txt"
$StartHost = Join-Path $PSScriptRoot "start-cms-windows.ps1"
$BuildUi = Join-Path $PSScriptRoot "build-ui-windows.ps1"

if (-not (Test-Path $StartHost)) {
    Write-Host "Thieu scripts\start-cms-windows.ps1" -ForegroundColor Red
    exit 1
}

if (Test-Path $BuildUi) {
    Write-Host "Build frontend/dist..." -ForegroundColor Cyan
    & $BuildUi
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build UI that bai - App se dung Docker UI neu co." -ForegroundColor Yellow
    }
}

# Reload Python (logo API + /media/brand) va rebuild image frontend.
$env:CMS_RESTART_BACKEND = "1"
$env:CMS_DOCKER_BUILD = "1"
$env:CMS_DOCKER_NO_CACHE = "1"
$env:CMS_DOCKER_WAIT_SEC = "20"
& $StartHost
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend chua san sang." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $Python)) {
    Write-Host "Thieu backend\.venv - chay deploy/start backend truoc." -ForegroundColor Red
    exit 1
}

if (Test-Path $DeskReq) {
    & $Python -m pip install -q -r $DeskReq
}

$exe = if (Test-Path $PythonW) { $PythonW } else { $Python }
Start-Process -FilePath $exe -ArgumentList @($Shell) -WorkingDirectory $Root
Write-Host "Da mo cua so CMS. Hard-refresh (Ctrl+F5) neu van thay UI cu." -ForegroundColor Green
