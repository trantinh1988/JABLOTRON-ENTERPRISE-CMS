@echo off
setlocal
cd /d "%~dp0.."

echo === Stop Jablotron CMS ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-cms.ps1"
echo.
pause
