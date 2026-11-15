@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-control.ps1" stop
if errorlevel 1 exit /b %errorlevel%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-control.ps1" start
exit /b %errorlevel%
