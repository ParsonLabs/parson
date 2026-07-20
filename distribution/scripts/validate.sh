#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$workspace"

status=0
fail() {
  echo "ERROR: $*" >&2
  status=1
}

for command in bash git; do
  command -v "$command" >/dev/null || fail "missing required command: $command"
done

bash -n distribution/winget/generate.sh || status=1
bash -n distribution/scripts/validate.sh || status=1

if command -v xmllint >/dev/null; then
  xmllint --noout distribution/unraid/repository/ca_profile.xml || status=1
  xmllint --noout distribution/unraid/repository/templates/parson.xml || status=1
else
  echo "SKIP: xmllint is not installed"
fi

if [[ -f node_modules/js-yaml/index.js ]]; then
  node -e 'const fs=require("node:fs"), yaml=require("js-yaml"); for (const f of process.argv.slice(1)) yaml.load(fs.readFileSync(f,"utf8"));' \
    distribution/truenas/ix-dev/community/parson/app.yaml \
    distribution/truenas/ix-dev/community/parson/item.yaml \
    distribution/truenas/ix-dev/community/parson/ix_values.yaml \
    distribution/truenas/ix-dev/community/parson/questions.yaml \
    distribution/truenas/ix-dev/community/parson/templates/test_values/basic-values.yaml || status=1

  winget_temp="$(mktemp -d -t parson-winget-validate-XXXXXX)"
  trap 'rm -rf "$winget_temp"' EXIT
  for template in distribution/winget/templates/*.yaml; do
    sed \
      -e 's|{{VERSION}}|1.0.0|g' \
      -e 's|{{INSTALLER_URL}}|https://example.com/Parson_1.0.0_x64-setup.exe|g' \
      -e 's|{{INSTALLER_SHA256}}|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|g' \
      -e 's|{{RELEASE_DATE}}|2026-07-20|g' \
      "$template" >"$winget_temp/$(basename "$template")"
  done
  node -e 'const fs=require("node:fs"), yaml=require("js-yaml"); for (const f of process.argv.slice(1)) yaml.load(fs.readFileSync(f,"utf8"));' \
    "$winget_temp"/*.yaml || status=1
else
  echo "SKIP: node_modules/js-yaml is not installed; YAML syntax was not checked"
fi

if rg -n 'REVIEW|TODO|TBD|YOUR_|example' distribution/truenas/ix-dev/community/parson \
  -g '!README.md'; then
  fail "TrueNAS payload contains unresolved review placeholders"
fi

if [[ -d distribution/winget/generated ]] && rg -n '\{\{[^}]+\}\}' distribution/winget/generated; then
  fail "generated WinGet manifests still contain template placeholders"
fi

for path in \
  apps/site/public/screenshots/01-home.png \
  apps/web/public/images/brand/parson-logo-512.png \
  apps/web/public/icons/icon.svg \
  Dockerfile \
  LICENSE; do
  [[ -s "$path" ]] || fail "required source asset is missing: $path"
done

if [[ "$status" -ne 0 ]]; then
  exit "$status"
fi
echo "Distribution static validation passed. External catalog and Windows checks remain documented in distribution/RELEASE.md."
