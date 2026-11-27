param(
    [Parameter(Mandatory=$true)][ValidateSet('start','stop','launch','ui')][string]$Action,
    [string]$BrowserPath,
    [string]$BrowserArgumentsBase64
)
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

function Get-ServerUrl {
    $startupLine = Get-Content -LiteralPath $logPath -TotalCount 1 -ErrorAction SilentlyContinue
    if ($startupLine -match '^d8sleep: (http://localhost:[0-9]+) ') { return $Matches[1] }
    return 'http://localhost:8787'
}

function Find-Python {
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
    return $python
}

function Get-ConfiguredPort([string]$Python) {
    Push-Location -LiteralPath $projectDir
    try {
        $value = & $Python -c "import os, server; server.load_env(); print(os.getenv('PORT', '8787'))"
        $port = 0
        if ($LASTEXITCODE -ne 0 -or -not [int]::TryParse($value, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
            throw 'Set PORT to a number from 1 to 65535, or leave it unset to use 8787.'
        }
        return $port
    } finally {
        Pop-Location
    }
}

function Test-ServerReady([int]$Port) {
    $response = $null
    $reader = $null
    try {
        $request = [Net.WebRequest]::Create("http://127.0.0.1:$Port/manifest.webmanifest")
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.Timeout = 1000
        $request.ReadWriteTimeout = 1000
        $response = $request.GetResponse()
        if ($response.StatusCode -ne 200 -or $response.ContentType -ne 'application/manifest+json') {
            return $false
        }
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        $manifest = $reader.ReadToEnd() | ConvertFrom-Json
        return $manifest.name -eq 'd8sleep' -and $manifest.id -eq '/'
    } catch {
        return $false
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
    }
}

function Start-Server([string]$Python) {
    $existing = Get-ManagedServer
    if ($existing) {
        Write-Host "d8sleep is already running (PID $($existing.ProcessId))."
        Write-Host (Get-ServerUrl)
        return
    }
    Write-Host 'Starting d8sleep...'
    if (-not $Python) { $Python = Find-Python }
    if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
    $process = Start-Process -FilePath $Python -ArgumentList @('-u', ('"' + $serverPath + '"')) -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errPath -PassThru
    Start-Sleep -Seconds 2
    $process.Refresh()
    if ($process.HasExited) { throw "d8sleep failed to start. Check .d8sleep-server-error.log; the port may already be in use." }
    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
    Write-Host "d8sleep started (PID $($process.Id))."
    Write-Host (Get-ServerUrl)
}

function Stop-Server {
    $existing = Get-ManagedServer
    if (-not $existing) {
        if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
        Write-Host 'd8sleep is not running from start.bat.'
        return
    }
    Write-Host "Stopping d8sleep (PID $($existing.ProcessId))..."
    Stop-Process -Id $existing.ProcessId -ErrorAction Stop
    Remove-Item -LiteralPath $pidPath -Force
    Write-Host 'd8sleep stopped.'
}

try {
    if ($Action -eq 'ui') {
        # The installed shortcut carries the browser profile and app ID.
        $programs = [Environment]::GetFolderPath('Programs')
        $desktop = [Environment]::GetFolderPath('DesktopDirectory')
        $shortcut = Get-ChildItem -LiteralPath $programs -Filter 'd8sleep.lnk' -File -Recurse |
            Select-Object -First 1
        if (-not $shortcut) {
            $shortcut = Get-Item -LiteralPath (Join-Path $desktop 'd8sleep.lnk') -ErrorAction SilentlyContinue
        }
        if (-not $shortcut) { throw 'No installed d8sleep shortcut was found. Install d8sleep in Chrome or Edge first.' }
        Start-Process -FilePath $shortcut.FullName
        return
    }

    # Serialize starts from the desktop shortcut, Start menu and batch files.
    $mutex = New-Object System.Threading.Mutex($false, 'Local\d8sleep-app-control')
    $locked = $false
    try {
        try {
            $locked = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
        } catch [System.Threading.AbandonedMutexException] {
            $locked = $true
        }
        if (-not $locked) { throw 'Timed out waiting for another d8sleep startup or shutdown.' }

        switch ($Action) {
            'stop' { Stop-Server }
            'start' { Start-Server }
            'launch' {
                if (-not $BrowserPath -or -not $BrowserArgumentsBase64) { throw 'The PWA shortcut is incomplete.' }
                $browserArguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($BrowserArgumentsBase64))
                $python = Find-Python
                $port = Get-ConfiguredPort $python
                if (-not (Test-ServerReady $port)) {
                    Start-Server $python
                    $deadline = [DateTime]::UtcNow.AddSeconds(10)
                    while (-not (Test-ServerReady $port)) {
                        if ([DateTime]::UtcNow -ge $deadline) {
                            throw "d8sleep did not respond on localhost:${port}. Check $errPath."
                        }
                        Start-Sleep -Milliseconds 250
                    }
                }
            }
        }
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
    if ($Action -eq 'launch') {
        Start-Process -FilePath $BrowserPath -ArgumentList $browserArguments
    }
} catch {
    if ($Action -eq 'launch') {
        $dialog = New-Object -ComObject WScript.Shell
        [void]$dialog.Popup($_.Exception.Message, 0, 'd8sleep could not open', 16)
    }
    Write-Error $_
    exit 1
}
