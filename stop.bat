@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-control.ps1" stop
exit /b %errorlevel%
