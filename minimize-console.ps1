Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleWindow {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
}
'@
$window = [ConsoleWindow]::GetConsoleWindow()
if ($window -ne [IntPtr]::Zero) {
    # Minimize without activating the console window.
    [void][ConsoleWindow]::ShowWindowAsync($window, 7)
}
