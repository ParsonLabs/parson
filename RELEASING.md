# Releasing Parson

The root `package.json` is the version source. The release command synchronises workspace packages, Rust manifests and lockfile, Expo version and build numbers, then creates a release commit and an annotated tag. It requires a clean checkout and a newer stable version.

```sh
bun run release 1.0.1
git push origin HEAD --follow-tags
```

Pushing the tag runs the stable release pipeline. It builds desktop installers for both architectures, the standalone Windows server, and versioned Docker images plus `latest`. It generates desktop update channels and the server manifest from those exact artifacts. No release-specific workflow edits are needed.

For an existing version, `bun run version:sync` refreshes generated version fields without committing or tagging. `bun run version:check` checks that everything agrees.

## One-time signing setup

For signed macOS desktop updates, configure `MACOS_CSC_LINK` and `MACOS_CSC_KEY_PASSWORD`, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for notarization. Unsigned macOS builds still work but offer manual downloads instead of auto-updates. Windows signing optionally uses `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`.

Signing secrets are inherited by the reusable build workflow. They are never stored in this repository.

## Update behaviour

Installed Windows and Linux AppImage releases check the stable GitHub channel after startup and every six hours. Signed macOS releases use the same channel. Updates download without stopping playback and install on normal quit. Settings → Account provides **Check for updates** and **Restart to update**. The desktop backend is stopped before installation, and the server and embedded UI update together.

Development builds, portable Windows executables, unsigned macOS builds and Linux package installations offer manual release downloads or package-manager updates. Stable clients never install nightly releases or downgrade. Existing builds without updater integration require one manual installation of an updater-enabled build.

The standalone Windows server keeps its existing on-demand **Check and install updates** tray action. Its release manifest is now generated and published by the same pipeline.

Docker publishes new images; the container host controls replacement. To update the supplied Compose deployment:

```sh
docker compose pull
docker compose up -d
```

A host-managed updater can schedule those operations. The server does not replace its own container. The hosted web UI updates with its server; reload browser clients after deployment. Website deployment continues through the existing hosting setup, with download URLs derived from the package version.

Data directories and music stay separate from installers. Back up the data directory before an update that changes database schemas; executable rollback does not roll back a migrated database.

## Verification

```sh
bun run version:check
node --test tools/release.test.cjs
bun --filter parson-music-desktop desktop:test
```

Before public rollout, exercise installation from the previous signed release on each target platform. Local unit tests do not validate platform signing or a published feed.
