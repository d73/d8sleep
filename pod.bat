@echo off
setlocal
set "POD_PYTHON=%LOCALAPPDATA%\Python\bin\python.exe"
if not exist "%POD_PYTHON%" set "POD_PYTHON=python"

rem Resolve the batch file itself so a symbolic link on PATH works too.
"%POD_PYTHON%" -c "import runpy, sys; from pathlib import Path; script = Path(sys.argv.pop(1)).resolve().with_name('pod.py'); sys.path[0] = str(script.parent); runpy.run_path(str(script), run_name='__main__')" "%~f0" %*
exit /b %errorlevel%
