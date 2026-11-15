param([Parameter(Mandatory=$true)][ValidateSet('start','stop')][string]$Action)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$serverPath = Join-Path $projectDir 'server.py'
$pidPath = Join-Path $projectDir '.d8sleep.pid'
$logPath = Join-Path $projectDir '.d8sleep-server.log'
$errPath = Join-Path $projectDir '.d8sleep-server-error.log'

function Get-ManagedServer {
    if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
    $idValue = 0
    if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$idValue)) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $idValue"
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($serverPath) -and $process.Name -match '^python(w|3(\.\d+)?)?\.exe$') { return $process }
    return $null
}

try {
    $existing = Get-ManagedServer
    if ($Action -eq 'stop') {
        if (-not $existing) {
            if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
            Write-Host 'd8sleep is not running from start.bat.'
            exit 0
        }
        Stop-Process -Id $existing.ProcessId -ErrorAction Stop
        Remove-Item -LiteralPath $pidPath -Force
        Write-Host 'd8sleep stopped.'
        exit 0
    }
    if ($existing) {
        Write-Host "d8sleep is already running (PID $($existing.ProcessId))."
        exit 0
    }
    if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
    $candidates = @((Join-Path $env:LOCALAPPDATA 'Python\bin\python.exe'))
    $candidates += @(Get-Command python.exe -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    $python = $null
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            $version = & $candidate -c 'import sys; print(int(sys.version_info >= (3, 10)))' 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -eq '1') { $python = $candidate; break }
        } catch { continue }
    }
    if (-not $python) { throw 'Python 3.10 or newer was not found. Install Python and try again.' }
    $process = Start-Process -FilePath $python -ArgumentList @('-u', ('"' + $serverPath + '"')) -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errPath -PassThru
    Start-Sleep -Seconds 2
    $process.Refresh()
    if ($process.HasExited) { throw "d8sleep failed to start. Check .d8sleep-server-error.log; the port may already be in use." }
    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
    Write-Host "d8sleep started (PID $($process.Id)). Open http://localhost:8787 or your configured port."
} catch {
    Write-Error $_
    exit 1
}
