param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
    [string]$Version = "1.0.0",
    [string]$OutputDirectory = "artifacts\windows"
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$previousLocation = Get-Location
Set-Location -LiteralPath $workspace
try {
    $configuredVersion = (Get-Content -LiteralPath (Join-Path $workspace "package.json") -Raw | ConvertFrom-Json).version
    if ($Version -ne $configuredVersion) {
        throw "Requested version $Version does not match package.json version $configuredVersion."
    }

    & bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "Installing JavaScript dependencies failed." }
    & bun --filter parson-music-desktop desktop:build
    if ($LASTEXITCODE -ne 0) { throw "Building the Windows Electron packages failed." }

    $bundle = Join-Path $workspace "target\release\bundle\electron"
    $output = Join-Path $workspace $OutputDirectory
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    Get-ChildItem -LiteralPath $bundle -File -Filter "*.exe" |
        Copy-Item -Destination $output -Force

    Write-Output "Created Windows Electron packages in: $output"
}
finally {
    Set-Location -LiteralPath $previousLocation
}
