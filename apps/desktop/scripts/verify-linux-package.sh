#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:-target/release/bundle/electron}"
bundle_dir="$(realpath "$bundle_dir")"
mapfile -t debs < <(find "$bundle_dir" -maxdepth 1 -type f -name '*.deb' -print)
mapfile -t appimages < <(find "$bundle_dir" -maxdepth 1 -type f -name '*.AppImage' -print)

if [[ "${#debs[@]}" -gt 1 || "${#appimages[@]}" -ne 1 ]]; then
  echo "Expected one AppImage and at most one optional .deb in $bundle_dir" >&2
  exit 1
fi

test -s "${appimages[0]}"
if [[ "${#debs[@]}" -eq 1 ]]; then
  test -s "${debs[0]}"
  if command -v dpkg-deb >/dev/null; then
    dpkg-deb --info "${debs[0]}" >/dev/null
  else
    ar t "${debs[0]}" | grep -qx 'debian-binary'
    ar t "${debs[0]}" | grep -q '^control\.tar'
    ar t "${debs[0]}" | grep -q '^data\.tar'
  fi
fi
chmod +x "${appimages[0]}"
extract_dir="$(mktemp -d -t parson-package-verify-XXXXXX)"
(cd "$extract_dir" && "${appimages[0]}" --appimage-extract >/dev/null)
test -x "$extract_dir/squashfs-root/AppRun"
test -x "$extract_dir/squashfs-root/resources/parson-music-server"
test -f "$extract_dir/squashfs-root/resources/app.asar"
rm -rf "$extract_dir"

sha256sum "${appimages[0]}" "${debs[@]}"
