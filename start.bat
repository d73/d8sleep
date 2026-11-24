@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0minimize-console.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-control.ps1" start
exit /b %errorlevel%
