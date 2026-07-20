# Parson distribution kit

This directory contains review-ready release and catalog material for Parson
1.0.0. Nothing in this directory submits, publishes, reserves a name, or creates
an account.

## Target status

| Target          | Artifact                  | Prepared here                                            | Remaining external action                                                                                    |
| --------------- | ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Microsoft Store | Signed x64 NSIS installer | Listing copy, package fields, policy checklist           | Create Partner Center account/product, obtain a trusted signing identity, upload the release URL, and submit |
| WinGet          | Signed x64 NSIS installer | Manifest templates and deterministic generator           | Publish `v1.0.0`, generate manifests, validate on Windows, and open a `winget-pkgs` PR                       |
| Flathub         | Source-built Flatpak      | Human-only audit and validation checklist                | A human must author/review the submission and open the PR because Flathub prohibits AI-generated submissions |
| AppImage        | x86_64 AppImage           | Existing build/release automation plus release checklist | Push a reviewed `v1.0.0` tag                                                                                 |
| TrueNAS Apps    | GHCR container            | Complete `ix-dev/community/parson` PR payload            | Publish the versioned container, test with TrueNAS tooling, and open a `truenas/apps` PR                     |
| Unraid          | GHCR container            | Complete standalone Community Apps repository payload    | Publish the versioned container, host the template repository, validate/scan it, and submit its URL          |

## Review order

1. Read [RELEASE.md](RELEASE.md) and resolve the two release blockers: Windows
   code signing and Flathub's human-authorship policy.
2. Review each target directory and the publisher-facing text it contains.
3. Run `./distribution/scripts/validate.sh`.
4. Follow the target-specific README only after the `v1.0.0` GitHub release and
   `ghcr.io/parsonlabs/parson-music:1.0.0` image exist.

## Shared release coordinates

- Version: `1.0.0`
- Git tag: `v1.0.0`
- Source: `https://github.com/ParsonLabs/parson`
- Release base: `https://github.com/ParsonLabs/parson/releases/download/v1.0.0`
- Container: `ghcr.io/parsonlabs/parson-music:1.0.0`
- License: `GPL-3.0-only`
- Default server port: `1993/tcp`
- Persistent container data: `/Parson`
- Music library mount: `/music` (read-only is recommended)

The GitHub repository currently has no releases, so cryptographic hashes cannot
be truthfully precomputed. The WinGet generator calculates the hash from the
immutable release asset after the first tag is published.
