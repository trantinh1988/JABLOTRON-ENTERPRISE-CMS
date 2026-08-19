# Khoi dong CMS USB tren Windows (autostart / trang He thong).
# Khong rebuild Docker, khong bat buoc USB da cam.
# Chay: .\scripts\start-cms-windows.ps1

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = Resolve-Path (Join-Path $PSScriptRoot "..") }
$Backend = Join-Path $Root "backend"
$LogDir = Join-Path $Root "logs"
$PidFile = Join-Path $LogDir "backend.pid"
$DataDir = Join-Path $Backend "data"
$Keys = Join-Path $Root "keys\public_key.pem"
$Port = if ($env:CMS_BACKEND_PORT) { $env:CMS_BACKEND_PORT } else { "8010" }
$UiPort = if ($env:CMS_UI_PORT) { $env:CMS_UI_PORT } else { "8080" }
$AutoLog = Join-Path $LogDir "autostart.log"

New-Item -ItemType Directory -Force -Path $LogDir, $DataDir | Out-Null
$PortsFile = Join-Path $DataDir "host_ports.json"
if (Test-Path $PortsFile) {
    try {
        $pj = Get-Content $PortsFile -Raw | ConvertFrom-Json
        if ($pj.ui_port) { $UiPort = [string]$pj.ui_port }
        if ($pj.api_port) { $Port = [string]$pj.api_port }
    } catch {}
}
$env:CMS_UI_PORT = $UiPort
$env:CMS_BACKEND_PORT = $Port
$nginxRuntime = Join-Path $DataDir "nginx-ui.conf"
if (-not (Test-Path $nginxRuntime)) {
    Copy-Item (Join-Path $Root "frontend\nginx.host-backend.conf") $nginxRuntime -ErrorAction SilentlyContinue
}
function Write-Auto([string]$msg) {
    $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $msg
    Add-Content -Path $AutoLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    Write-Host $line
}

Set-Location $Root
Write-Auto "start-cms-windows begin root=$Root"

if ($env:CMS_AUTOSTART -eq "1") {
    Write-Auto "autostart delay 20s (user profile / Docker Desktop)"
    Start-Sleep -Seconds 20
}

if (-not (Test-Path $Keys)) {
    Write-Auto "MISSING keys/public_key.pem"
    exit 1
}

function Test-BackendOk {
    try {
        $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 3
        return ($health.status -eq "ok")
    } catch {
        return $false
    }
}

function Wait-Docker([int]$Seconds = 240) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        docker info 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep -Seconds 5
    }
    return $false
}

if (-not (Test-BackendOk)) {
    Write-Auto "starting native backend :$Port"
    Set-Location $Backend
    $python = Join-Path $Backend ".venv\Scripts\python.exe"
    if (-not (Test-Path $python)) {
        Write-Auto "creating venv"
        python -m venv .venv
        & ".\.venv\Scripts\Activate.ps1"
        pip install -r requirements.txt -q
        $python = Join-Path $Backend ".venv\Scripts\python.exe"
    }
    $dbFile = (Join-Path $DataDir "cms.db") -replace '\\', '/'
    $env:CMS_USB_MOCK_MODE = "false"
    $env:CMS_JABLOTRON_VENDOR_ID = "0x16D6"
    $env:CMS_JABLOTRON_PRODUCT_ID = "0x0008"
    $env:CMS_PUBLIC_KEY_PATH = $Keys
    $env:CMS_DATABASE_URL = "sqlite+aiosqlite:///$dbFile"
    $env:CMS_HWID_CACHE_PATH = (Join-Path $DataDir "hwid.cache")
    $env:CMS_CORS_ORIGINS = "http://localhost:$UiPort,http://127.0.0.1:$UiPort,http://localhost:5173,http://127.0.0.1:5173"

    $logFile = Join-Path $LogDir "backend.log"
    $errFile = Join-Path $LogDir "backend.err.log"
    foreach ($f in @($logFile, $errFile)) {
        if (Test-Path $f) {
            try { Remove-Item $f -Force -ErrorAction Stop } catch {
                $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
                $logFile = Join-Path $LogDir "backend-$stamp.log"
                $errFile = Join-Path $LogDir "backend-$stamp.err.log"
                break
            }
        }
    }
    $proc = Start-Process -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$Port") `
        -WorkingDirectory $Backend `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError $errFile `
        -WindowStyle Hidden `
        -PassThru
    if (-not $proc) {
        Write-Auto "Start-Process uvicorn failed"
        exit 1
    }
    $proc.Id | Set-Content -Path $PidFile -Encoding ascii
    Write-Auto "uvicorn pid=$($proc.Id)"
    $ready = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Seconds 1
        if (Test-BackendOk) { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Auto "backend not ready on :$Port"
        if (Test-Path $errFile) { Get-Content $errFile -Tail 20 | ForEach-Object { Write-Auto $_ } }
        exit 1
    }
    Write-Auto "backend health ok"
} else {
    Write-Auto "backend already running :$Port"
}

Set-Location $Root
if (Wait-Docker 240) {
    Write-Auto "docker ready — USB-host UI"
    docker stop jablotron-cms-backend 2>$null | Out-Null
    docker rm jablotron-cms-backend 2>$null | Out-Null
    docker compose -f docker-compose.yml stop backend 2>$null | Out-Null
    docker compose -f docker-compose.usb-host.yml up -d --remove-orphans
    Write-Auto "compose usb-host done"
} else {
    Write-Auto "Docker Desktop not ready — backend USB still running"
}

Write-Auto "done UI http://127.0.0.1:$UiPort API http://127.0.0.1:$Port/api/health"
