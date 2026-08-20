# Dong goi cua so client CMS thanh JablotronCMSClient.exe (khong gom backend USB).
# Can: pip trong backend\.venv, pywebview + pyinstaller.
# Chay: .\scripts\build-client-exe.ps1
# Ket qua: dist\JablotronCMSClient.exe

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = Resolve-Path (Join-Path $PSScriptRoot "..") }
$Python = Join-Path $Root "backend\.venv\Scripts\python.exe"
$Shell = Join-Path $Root "desktop\cms_shell.py"
$OutDir = Join-Path $Root "dist"
$Work = Join-Path $Root "build\pyinstaller-client"

if (-not (Test-Path $Python)) {
    Write-Host "Thieu backend\.venv - tao venv backend truoc." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $Shell)) {
    Write-Host "Thieu desktop\cms_shell.py" -ForegroundColor Red
    exit 1
}

& $Python -m pip install -q pywebview pyinstaller
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Set-Location $Root
& $Python -m PyInstaller --noconfirm --clean --onefile --windowed `
    --name JablotronCMSClient `
    --distpath $OutDir `
    --workpath $Work `
    --specpath $Work `
    $Shell
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $OutDir "JablotronCMSClient.exe"
if (-not (Test-Path $exe)) {
    Write-Host "Khong thay $exe" -ForegroundColor Red
    exit 1
}
Write-Host "OK $exe" -ForegroundColor Green
Write-Host "May truc: mo exe, nhap IP + port UI cua may server (vd 192.168.1.10 va 8080)."
