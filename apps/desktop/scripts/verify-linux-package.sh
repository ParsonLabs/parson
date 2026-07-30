#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:-target/release/bundle/electron}"
bundle_dir="$(realpath "$bundle_dir")"
mapfile -t debs < <(find "$bundle_dir" -maxdepth 1 -type f -name '*.deb' -print)
mapfile -t appimages < <(find "$bundle_dir" -maxdepth 1 -type f -name '*.AppImage' -print)

if [[ "${#debs[@]}" -ne 1 || "${#appimages[@]}" -ne 1 ]]; then
  echo "Expected one AppImage and one .deb in $bundle_dir" >&2
  exit 1
fi

test -s "${appimages[0]}"
file "${appimages[0]}" | grep -q 'static-pie linked'
test -s "${debs[0]}"
if command -v dpkg-deb >/dev/null; then
  dpkg-deb --info "${debs[0]}" >/dev/null
else
  ar t "${debs[0]}" | grep -qx 'debian-binary'
  ar t "${debs[0]}" | grep -q '^control\.tar'
  ar t "${debs[0]}" | grep -q '^data\.tar'
fi
chmod +x "${appimages[0]}"
extract_dir="$(mktemp -d -t parson-package-verify-XXXXXX)"
trap 'rm -rf "$extract_dir"' EXIT
(cd "$extract_dir" && "${appimages[0]}" --appimage-extract >/dev/null)
test -x "$extract_dir/squashfs-root/AppRun"
test -x "$extract_dir/squashfs-root/resources/parson-music-server"
test -f "$extract_dir/squashfs-root/resources/app.asar"
test -s "$extract_dir/squashfs-root/resources/LICENSE"
grep -q 'GNU GENERAL PUBLIC LICENSE' \
  "$extract_dir/squashfs-root/resources/LICENSE"
test -s "$extract_dir/squashfs-root/resources/THIRD_PARTY_NOTICES.md"
test -s "$extract_dir/squashfs-root/LICENSE.electron.txt"
test -s "$extract_dir/squashfs-root/LICENSES.chromium.html"
bunx asar list "$extract_dir/squashfs-root/resources/app.asar" |
  grep -qx '/electron/linux-installer.cjs'
deb_extract="$extract_dir/deb"
mkdir "$deb_extract"
if command -v dpkg-deb >/dev/null; then
  dpkg-deb --extract "${debs[0]}" "$deb_extract"
else
  archive_extract="$extract_dir/deb-archive"
  mkdir "$archive_extract"
  (cd "$archive_extract" && ar x "${debs[0]}")
  data_archive="$(find "$archive_extract" -maxdepth 1 -type f -name 'data.tar.*' -print -quit)"
  test -n "$data_archive"
  tar -xf "$data_archive" -C "$deb_extract"
fi
for filename in \
  LICENSE \
  THIRD_PARTY_NOTICES.md \
  LICENSE.electron.txt \
  LICENSES.chromium.html; do
  if ! find "$deb_extract" -type f -name "$filename" -print -quit | grep -q .; then
    echo "Debian package is missing $filename." >&2
    exit 1
  fi
done
required_glibc="$(
  readelf --version-info \
    "$extract_dir/squashfs-root/resources/parson-music-server" |
    sed -n 's/.*Name: GLIBC_\([0-9][0-9.]*\).*/\1/p' |
    sort -V |
    tail -1
)"
if [[ -z "$required_glibc" ]] || [[ "$(printf '%s\n' "$required_glibc" 2.35 | sort -V | tail -1)" != 2.35 ]]; then
  echo "Backend requires GLIBC_${required_glibc:-unknown}; maximum supported baseline is GLIBC_2.35." >&2
  exit 1
fi

sha256sum "${appimages[0]}" "${debs[@]}"
