# Parson desktop client

Electron client for Linux and Windows.

## Development

```powershell
bun --filter parson-music-desktop desktop:dev
```

## Packaging

```powershell
bun --filter parson-music-desktop desktop:build
```

Linux package check:

```bash
./apps/desktop/scripts/verify-linux-package.sh
```

Windows release:

```powershell
.\apps\desktop\scripts\package-windows.ps1 -Version 1.0.0
```
