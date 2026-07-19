# Parson Music server for Windows

Windows notification-area server with an embedded web UI.

## Use

Run `ParsonMusicServer.exe`. Data is stored in `%LOCALAPPDATA%\Parson` and the UI
opens at `http://127.0.0.1:1993`.

Environment variables: `PARSON_DATA_DIR`, `PARSON_PORT`, and
`PARSON_LIBRARY_NAME`. FFmpeg is required for transcoding.

## Build and package

```powershell
bun install --frozen-lockfile
bun --filter parson-music-web build
.\crates\windows-server\package.ps1
```
