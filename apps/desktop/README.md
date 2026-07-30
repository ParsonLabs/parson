# Parson desktop client

Electron client for Linux, macOS, and Windows.

Official Linux packages are built on Ubuntu 22.04 and require glibc 2.35 or
newer. This includes Ubuntu 22.04+, Debian 12+, and distributions with an
equivalent or newer userspace.

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
bash ./apps/desktop/scripts/verify-linux-package.sh
```

The AppImage uses a static runtime and does not require FUSE. When opened from
a download location, it offers to install or update itself for the current
user, creates the desktop integration, and relaunches from a stable path. The
same flow can be requested non-interactively:

```bash
./Parson_VERSION_ARCH.AppImage --install
```

Windows release:

```powershell
.\apps\desktop\scripts\package-windows.ps1 -Version 1.0.0
```

macOS package check:

```bash
bash ./apps/desktop/scripts/verify-macos-package.sh
```

Release packages are built without paid platform signing credentials. GitHub
build provenance is attached to stable release artifacts.
