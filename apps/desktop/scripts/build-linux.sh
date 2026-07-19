#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$workspace/apps/desktop"
bunx electron-builder --linux AppImage

if ldconfig -p 2>/dev/null | grep -q 'libcrypt\.so\.1'; then
  bunx electron-builder --linux deb
else
  echo "Skipping optional .deb: this host does not provide libcrypt.so.1 for electron-builder's fpm." >&2
fi
