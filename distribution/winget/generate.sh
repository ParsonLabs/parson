#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "usage: $0 VERSION [INSTALLER_URL]" >&2
  exit 2
fi

url="${2:-https://github.com/ParsonLabs/parson/releases/download/v${version}/Parson_${version}_x64-setup.exe}"
release_date="${3:-$(date -u +%F)}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output="$script_dir/generated/manifests/p/ParsonLabs/Parson/$version"
temporary="$(mktemp -d -t parson-winget-XXXXXX)"
trap 'rm -rf "$temporary"' EXIT

curl --fail --location --proto '=https' --tlsv1.2 --output "$temporary/installer.exe" "$url"
sha256="$(sha256sum "$temporary/installer.exe" | cut -d' ' -f1 | tr '[:lower:]' '[:upper:]')"
mkdir -p "$output"

for template in "$script_dir/templates"/*.yaml; do
  destination="$output/$(basename "$template" .template.yaml).yaml"
  sed \
    -e "s|{{VERSION}}|$version|g" \
    -e "s|{{INSTALLER_URL}}|$url|g" \
    -e "s|{{INSTALLER_SHA256}}|$sha256|g" \
    -e "s|{{RELEASE_DATE}}|$release_date|g" \
    "$template" >"$destination"
done

echo "Generated WinGet manifests in $output"
echo "Installer SHA-256: $sha256"
