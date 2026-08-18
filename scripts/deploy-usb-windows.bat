@echo off
setlocal
cd /d "%~dp0.."

echo === Deploy Jablotron CMS (USB Windows) ===
echo Thu muc: %CD%
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [LOI] Chua co Docker trong PATH. Hay mo Docker Desktop roi thu lai.
  goto :end
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-usb-windows.ps1"
set ERR=%ERRORLEVEL%

echo.
if %ERR% neq 0 (
  echo [LOI] Deploy that bai, ma loi: %ERR%
) else (
  echo [OK] Mo UI: http://127.0.0.1:8080
)

:end
echo.
pause
exit /b %ERR%
