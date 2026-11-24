@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0minimize-console.ps1"
if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
  "%LOCALAPPDATA%\Python\bin\python.exe" "%~dp0pod.py" %*
) else (
  python "%~dp0pod.py" %*
)
exit /b %errorlevel%
