@echo off
if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
  "%LOCALAPPDATA%\Python\bin\python.exe" "%~dp0pod.py" %*
) else (
  python "%~dp0pod.py" %*
)
exit /b %errorlevel%
