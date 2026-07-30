#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
bundle_dir="$workspace/target/release/bundle/electron"
architecture="${PARSON_BUILD_ARCH:-$(uname -m)}"

case "$architecture" in
  x64 | x86_64 | amd64)
    artifact_arch="x64"
    expected_arch="x86_64"
    ;;
  arm64 | aarch64)
    artifact_arch="arm64"
    expected_arch="arm64"
    ;;
  *)
    echo "Unsupported macOS package architecture: $architecture" >&2
    exit 1
    ;;
esac

version="$(node -p "require('$workspace/apps/desktop/package.json').version")"
app="$(find "$bundle_dir" -maxdepth 3 -type d -name Parson.app -print -quit)"
dmg="$(find "$bundle_dir" -maxdepth 1 -type f -name "Parson_${version}_${artifact_arch}.dmg" -print -quit)"
zip="$(find "$bundle_dir" -maxdepth 1 -type f -name "Parson_${version}_${artifact_arch}.zip" -print -quit)"

for path in "$app" "$dmg" "$zip"; do
  if [[ -z "$path" || ! -e "$path" ]]; then
    echo "Required macOS package output is missing: ${path:-unknown path}" >&2
    exit 1
  fi
done

for path in \
  "$app/Contents/Resources/LICENSE" \
  "$app/Contents/Resources/THIRD_PARTY_NOTICES.md" \
  "$app/Contents/Resources/app.asar" \
  "$app/Contents/Resources/parson-music-server"; do
  [[ -s "$path" ]] || {
    echo "macOS application is missing required payload: $path" >&2
    exit 1
  }
done

for executable in \
  "$app/Contents/MacOS/Parson" \
  "$app/Contents/Resources/parson-music-server"; do
  if ! lipo -archs "$executable" | tr ' ' '\n' | grep -Fqx "$expected_arch"; then
    echo "$executable does not contain the expected $expected_arch architecture." >&2
    exit 1
  fi
done

unzip -Z1 "$zip" | grep -Fqx "Parson.app/Contents/Resources/LICENSE"
unzip -Z1 "$zip" | grep -Fqx "Parson.app/Contents/Resources/THIRD_PARTY_NOTICES.md"

echo "macOS $artifact_arch DMG, ZIP, application payload, and native architectures verified."
