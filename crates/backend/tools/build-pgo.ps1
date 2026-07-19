$ErrorActionPreference = 'Stop'

if (-not $env:PARSON_TEST_LIBRARY -or -not (Test-Path -LiteralPath $env:PARSON_TEST_LIBRARY -PathType Container)) {
    throw 'PARSON_TEST_LIBRARY must name the intended music directory'
}

$Workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$ProfileRoot = if ($env:PARSON_PGO_DIR) { $env:PARSON_PGO_DIR } else { Join-Path $Workspace 'target/indexer-pgo' }
$RawProfiles = Join-Path $ProfileRoot 'raw'
$MergedProfile = Join-Path $ProfileRoot 'indexer.profdata'
New-Item -ItemType Directory -Force -Path $RawProfiles | Out-Null
Get-ChildItem -LiteralPath $RawProfiles -Filter '*.profraw' -File -ErrorAction SilentlyContinue | Remove-Item

$LlvmProfdata = $env:LLVM_PROFDATA
if (-not $LlvmProfdata) {
    $LlvmProfdata = (& rustup which llvm-profdata 2>$null)
}
if (-not $LlvmProfdata) {
    $command = Get-Command llvm-profdata -ErrorAction SilentlyContinue
    if ($command) { $LlvmProfdata = $command.Source }
}
if (-not $LlvmProfdata) {
    throw 'llvm-profdata is required (rustup component add llvm-tools-preview)'
}

Push-Location $Workspace
try {
    $OriginalRustflags = $env:RUSTFLAGS
    $env:RUSTFLAGS = "$OriginalRustflags -Cprofile-generate=$RawProfiles"
    cargo test --release -p parson-music --lib benchmarks_external_library_warm_refresh -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'instrumented indexing benchmark failed' }

    $Profiles = @(Get-ChildItem -LiteralPath $RawProfiles -Filter '*.profraw' -File | ForEach-Object FullName)
    if ($Profiles.Count -eq 0) { throw 'the indexing workload produced no raw profiles' }
    & $LlvmProfdata merge -o $MergedProfile @Profiles
    if ($LASTEXITCODE -ne 0) { throw 'profile merge failed' }

    $env:RUSTFLAGS = "$OriginalRustflags -Cprofile-use=$MergedProfile"
    cargo build --release -p parson-music --bin parson-music-server
    if ($LASTEXITCODE -ne 0) { throw 'PGO release build failed' }
    Write-Host "PGO release built with $MergedProfile"
}
finally {
    $env:RUSTFLAGS = $OriginalRustflags
    Pop-Location
}
