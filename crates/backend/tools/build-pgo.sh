#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PARSON_TEST_LIBRARY:-}" || ! -d "${PARSON_TEST_LIBRARY}" ]]; then
  echo "PARSON_TEST_LIBRARY must name the intended music directory" >&2
  exit 2
fi

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
profile_root="${PARSON_PGO_DIR:-${workspace}/target/indexer-pgo}"
raw_profiles="${profile_root}/raw"
merged_profile="${profile_root}/indexer.profdata"
mkdir -p "${raw_profiles}"
find "${raw_profiles}" -maxdepth 1 -type f -name '*.profraw' -delete

llvm_profdata="${LLVM_PROFDATA:-}"
if [[ -z "${llvm_profdata}" ]]; then
  llvm_profdata="$(rustup which llvm-profdata 2>/dev/null || command -v llvm-profdata || true)"
fi
if [[ -z "${llvm_profdata}" ]]; then
  echo "llvm-profdata is required (rustup component add llvm-tools-preview)" >&2
  exit 2
fi

cd "${workspace}"
RUSTFLAGS="${RUSTFLAGS:-} -Cprofile-generate=${raw_profiles}" \
  cargo test --release -p parson-music --lib \
  benchmarks_external_library_warm_refresh -- --ignored --nocapture

mapfile -d '' profiles < <(find "${raw_profiles}" -type f -name '*.profraw' -print0)
if (( ${#profiles[@]} == 0 )); then
  echo "the indexing workload produced no raw profiles" >&2
  exit 1
fi
"${llvm_profdata}" merge -o "${merged_profile}" "${profiles[@]}"

RUSTFLAGS="${RUSTFLAGS:-} -Cprofile-use=${merged_profile}" \
  cargo build --release -p parson-music --bin parson-music-server
echo "PGO release built with ${merged_profile}"
