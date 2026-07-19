param(
    [string]$Executable = "target\release\ParsonMusicServer.exe"
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$source = (Resolve-Path -LiteralPath (Join-Path $workspace $Executable)).Path
$testRoot = Join-Path $workspace "target\windows-updater-e2e"
$fixture = Join-Path $testRoot "release"
$install = Join-Path $testRoot "install"
$data = Join-Path $testRoot "data"
$installedExecutable = Join-Path $install "ParsonMusicServer.exe"
$updateExecutable = Join-Path $fixture "ParsonMusicServer-update.exe"
$instanceId = "updater-e2e-" + [Guid]::NewGuid().ToString("N")

function Get-FreeTcpPort {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    return $port
}

function Wait-ForHealth([int]$Port, [int]$Attempts = 80) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 1
            if ($response.StatusCode -eq 200) { return $true }
        }
        catch {}
        Start-Sleep -Milliseconds 250
    }
    return $false
}

Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $fixture, $install, $data -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $installedExecutable
Copy-Item -LiteralPath $source -Destination $updateExecutable

# A trailing byte keeps this a runnable PE while making replacement observable.
$stream = [IO.File]::Open($updateExecutable, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::None)
$stream.WriteByte(0x7f)
$stream.Dispose()
$update = Get-Item -LiteralPath $updateExecutable
$updateHash = (Get-FileHash -LiteralPath $updateExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
$webPort = Get-FreeTcpPort
do { $serverPort = Get-FreeTcpPort } while ($serverPort -eq $webPort)
$manifest = [ordered]@{
    version = "99.0.0"
    url = "http://127.0.0.1:$webPort/ParsonMusicServer-update.exe"
    sha256 = $updateHash
    size = $update.Length
} | ConvertTo-Json
[IO.File]::WriteAllText(
    (Join-Path $fixture "windows-server-update.json"),
    $manifest,
    (New-Object Text.UTF8Encoding($false))
)

$pythonCommand = Get-Command python -ErrorAction Stop
$python = Start-Process $pythonCommand.Source `
    -ArgumentList "-m", "http.server", "$webPort", "--bind", "127.0.0.1", "--directory", $fixture `
    -WindowStyle Hidden -PassThru
$fixtureReady = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$webPort/windows-server-update.json" -TimeoutSec 1
        if ($response.StatusCode -eq 200) { $fixtureReady = $true; break }
    }
    catch {}
    Start-Sleep -Milliseconds 100
}
if (-not $fixtureReady) {
    Stop-Process -Id $python.Id -Force -ErrorAction SilentlyContinue
    throw "Local update fixture server did not start."
}

$oldEnvironment = @{
    PARSON_DATA_DIR = $env:PARSON_DATA_DIR
    PARSON_PORT = $env:PARSON_PORT
    PARSON_UPDATE_MANIFEST_URL = $env:PARSON_UPDATE_MANIFEST_URL
    PARSON_HOST_INSTANCE_ID = $env:PARSON_HOST_INSTANCE_ID
}

try {
    $env:PARSON_DATA_DIR = $data
    $env:PARSON_PORT = "$serverPort"
    $env:PARSON_UPDATE_MANIFEST_URL = "http://127.0.0.1:$webPort/windows-server-update.json"
    $env:PARSON_HOST_INSTANCE_ID = $instanceId
    $app = Start-Process $installedExecutable -ArgumentList "--background" -WindowStyle Hidden -PassThru
    if (-not (Wait-ForHealth $serverPort)) { throw "Initial Parson for Windows did not become healthy." }

    if (-not ("ParsonUpdaterE2E" -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ParsonUpdaterE2E {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    public static bool ClickUpdate(uint wantedProcessId) {
        bool found = false;
        EnumWindows((hwnd, state) => {
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            if (processId == wantedProcessId) {
                found = true;
                PostMessage(hwnd, 0x0111, (IntPtr)1009, IntPtr.Zero);
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
    }

    if (-not [ParsonUpdaterE2E]::ClickUpdate($app.Id)) { throw "Updater tray window was not found." }
    if (-not $app.WaitForExit(20000)) { throw "Old Parson for Windows did not stop for the update." }
    if (-not (Wait-ForHealth $serverPort)) { throw "Updated Parson for Windows did not relaunch healthy." }
    Start-Sleep -Seconds 2

    $installedHash = (Get-FileHash -LiteralPath $installedExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installedHash -ne $updateHash) { throw "Installed executable does not match the verified update." }
    if (Test-Path -LiteralPath ($installedExecutable + ".update-backup")) { throw "Update backup was not cleaned." }
    $helpers = @(Get-ChildItem (Join-Path $data "Updates") -File -ErrorAction SilentlyContinue)
    if ($helpers.Count -ne 0) { throw "Downloaded update helper was not cleaned." }

    Write-Output "Windows updater end-to-end test passed on ports $serverPort and $webPort."
}
finally {
    Get-Process ParsonMusicServer -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $installedExecutable } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $python.Id -Force -ErrorAction SilentlyContinue
    foreach ($name in $oldEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], "Process")
    }
}
