param([switch]$Restore)

$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$launcher = Join-Path $PSScriptRoot 'app-control.ps1'
$powershell = (Get-Command powershell.exe -CommandType Application).Source
$prefix = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" launch -BrowserPath '
$wrappedPattern = '^' + [regex]::Escape($prefix) + '"(?<browser>[^"]+)" -BrowserArgumentsBase64 (?<arguments>[A-Za-z0-9+/=]+)$'
$folders = @(
    [Environment]::GetFolderPath('DesktopDirectory')
    [Environment]::GetFolderPath('Programs')
)
$found = $false

foreach ($folder in $folders) {
    foreach ($file in (Get-ChildItem -LiteralPath $folder -Filter 'd8sleep.lnk' -File -Recurse)) {
        $shortcut = $shell.CreateShortcut($file.FullName)
        if ($shortcut.TargetPath -eq $powershell -and $shortcut.Arguments -match $wrappedPattern) {
            $found = $true
            if ($Restore) {
                $shortcut.TargetPath = $Matches.browser
                $shortcut.Arguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches.arguments))
                $shortcut.Save()
                Write-Host "Restored $($file.FullName)"
            } else {
                Write-Host "Already configured $($file.FullName)"
            }
            continue
        }
        if ($Restore -or
            [IO.Path]::GetFileName($shortcut.TargetPath) -notin @('chrome_proxy.exe', 'msedge_proxy.exe', 'chrome.exe', 'msedge.exe') -or
            $shortcut.Arguments -notmatch '(?:^|\s)--app-id=[a-z]{32}(?:\s|$)') {
            continue
        }

        $found = $true
        $browser = $shortcut.TargetPath
        $arguments = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($shortcut.Arguments))
        $shortcut.TargetPath = $powershell
        $shortcut.Arguments = $prefix + '"' + $browser + '" -BrowserArgumentsBase64 ' + $arguments
        $shortcut.Save()
        Write-Host "Configured $($file.FullName)"
    }
}

if (-not $found) {
    if ($Restore) { throw 'No d8sleep shortcuts configured by this checkout were found.' }
    throw 'No installed d8sleep shortcuts were found. Install d8sleep in Chrome or Edge first.'
}
