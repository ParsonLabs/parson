# TrueNAS Apps submission

`ix-dev/community/parson/` is the PR payload for the current Docker Compose-based
`truenas/apps` catalog. Only copy this directory into a fresh fork's
`ix-dev/community/`; do not edit generated `trains/` content.

## Required refresh before PR

TrueNAS's catalog library changes independently of Parson. Immediately before
submission:

1. Clone the current `https://github.com/truenas/apps` default branch.
2. Copy `distribution/truenas/ix-dev/community/parson` to
   `ix-dev/community/parson`.
3. Compare with a current single-container music app such as Navidrome.
4. Confirm `lib_version` and `lib_version_hash` still match the current catalog;
   this kit uses `2.3.8` and the matching hash observed on 2026-07-20.
5. Attach the upstream icon and screenshots listed in `pr-description.md`. The
   prepared metadata uses their expected final TrueNAS CDN paths; a reviewer
   uploads the assets during review.
6. Run the repository's metadata generator and CI commands from its current
   `CONTRIBUTIONS.md`.
7. Test install, first-run setup, music scanning, playback, health checks,
   restart, upgrade, and uninstall while preserving the data volume.
8. Open a draft PR to `truenas/apps`; all new apps target the community train.

The catalog definition runs Parson as its image user `10001:10001`, uses a
permission helper for the data dataset, mounts music read-only, and exposes only
the configurable WebUI port.
