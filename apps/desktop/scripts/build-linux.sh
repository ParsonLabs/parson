#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$workspace/apps/desktop"

case "${PARSON_BUILD_ARCH:-$(uname -m)}" in
  x64 | x86_64 | amd64)
    arch_flag="--x64"
    ;;
  arm64 | aarch64)
    arch_flag="--arm64"
    ;;
  *)
    echo "Unsupported Linux package architecture: ${PARSON_BUILD_ARCH:-$(uname -m)}" >&2
    exit 1
    ;;
esac

bunx electron-builder --linux AppImage deb "$arch_flag"
