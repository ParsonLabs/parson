param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
    [string]$Version = "1.0.0",
    [string]$OutputDirectory = "artifacts\windows-server",
    [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$output = Join-Path $workspace $OutputDirectory
$staging = Join-Path $workspace "target\windows-server-package"

if (-not $SkipWebBuild) {
    & bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "Installing web dependencies failed." }
    & bun --filter parson-music-web build
    if ($LASTEXITCODE -ne 0) { throw "Building the embedded web UI failed." }
}

& cargo build --locked --release -p parson-music-windows-server
if ($LASTEXITCODE -ne 0) { throw "Building Parson for Windows failed." }

foreach ($path in @($output, $staging)) {
    if (Test-Path -LiteralPath $path) {
        $resolved = (Resolve-Path -LiteralPath $path).Path
        if (-not $resolved.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar)) {
            throw "Refusing to remove a path outside the workspace: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
New-Item -ItemType Directory -Path $output, $staging -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $workspace "target\release\ParsonMusicServer.exe") -Destination $staging
Copy-Item -LiteralPath (Join-Path $workspace "crates\windows-server\README.md") -Destination $staging
Copy-Item -LiteralPath (Join-Path $workspace "LICENSE") -Destination $staging

$archive = Join-Path $output "ParsonMusicServer-$Version-win-x64.zip"
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $archive -CompressionLevel Optimal

$executable = Join-Path $output "ParsonMusicServer.exe"
Copy-Item -LiteralPath (Join-Path $workspace "target\release\ParsonMusicServer.exe") -Destination $executable
$hash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $executable).Length
$manifest = [ordered]@{
    version = $Version
    url = "https://github.com/ParsonLabs/Parson/releases/download/v$Version/ParsonMusicServer.exe"
    sha256 = $hash
    size = $size
} | ConvertTo-Json
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$newline = [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $output "windows-server-update.json"), $manifest + $newline, $utf8WithoutBom)
[IO.File]::WriteAllText((Join-Path $output "ParsonMusicServer.exe.sha256"), "$hash  ParsonMusicServer.exe$newline", $utf8WithoutBom)

Write-Output "Created Windows server package: $archive"
Write-Output "Created one-click update assets in: $output"
