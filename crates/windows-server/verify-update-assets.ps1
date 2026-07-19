param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
    [string]$Version = "1.0.0",
    [string]$Directory = "artifacts\windows-server"
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$assets = Join-Path $workspace $Directory
$executable = Join-Path $assets "ParsonMusicServer.exe"
$manifestPath = Join-Path $assets "windows-server-update.json"
$checksumPath = Join-Path $assets "ParsonMusicServer.exe.sha256"

foreach ($path in @($executable, $manifestPath, $checksumPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing Windows update asset: $path"
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedSize = (Get-Item -LiteralPath $executable).Length
$expectedUrl = "https://github.com/ParsonLabs/Parson/releases/download/v$Version/ParsonMusicServer.exe"
$sidecarHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0]

if ($manifest.version -ne $Version) { throw "Update manifest version does not match $Version." }
if ($manifest.url -ne $expectedUrl) { throw "Update manifest URL does not match the tagged release URL." }
if ($manifest.sha256 -ne $expectedHash) { throw "Update manifest SHA-256 does not match ParsonMusicServer.exe." }
if ([int64]$manifest.size -ne $expectedSize) { throw "Update manifest size does not match ParsonMusicServer.exe." }
if ($sidecarHash -ne $expectedHash) { throw "SHA-256 sidecar does not match ParsonMusicServer.exe." }

Write-Output "Windows update assets verified for version $Version ($expectedSize bytes)."
