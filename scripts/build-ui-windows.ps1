# Build React SPA -> frontend/dist (served by native backend :API, no Docker UI needed).
# Chay: .\scripts\build-ui-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = Resolve-Path (Join-Path $PSScriptRoot "..") }
$Frontend = Join-Path $Root "frontend"
$Index = Join-Path $Frontend "dist\index.html"

if (-not (Test-Path (Join-Path $Frontend "package.json"))) {
    Write-Host "Khong thay frontend/package.json" -ForegroundColor Red
    exit 1
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Host "Can Node.js/npm de build UI (frontend/dist)." -ForegroundColor Red
    exit 1
}

Set-Location $Frontend
if (-not (Test-Path "node_modules")) {
    Write-Host "npm ci..." -ForegroundColor Cyan
    npm ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "npm run build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path $Index)) {
    Write-Host "Build xong nhung thieu frontend/dist/index.html" -ForegroundColor Red
    exit 1
}

Write-Host "UI dist: $Index" -ForegroundColor Green
