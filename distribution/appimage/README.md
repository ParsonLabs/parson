# AppImage release

Parson already produces an x86_64 AppImage through electron-builder. The tagged
release workflow builds it, extracts it, verifies `AppRun`, the bundled backend,
and `app.asar`, calculates checksums, and attaches it to the GitHub release.

## Review and release

```bash
bun install --frozen-lockfile
bun --filter parson-music-desktop desktop:build
bash ./apps/desktop/scripts/verify-linux-package.sh
```

Then smoke-test the artifact from `target/release/bundle/electron/`:

```bash
chmod +x Parson_1.0.0_x86_64.AppImage
./Parson_1.0.0_x86_64.AppImage
```

Use the actual electron-builder filename if it differs. On the GitHub release,
publish the AppImage and `SHA256SUMS`; users only need to download it, mark it
executable, and run it.

## Optional post-1.0 enhancement

The official AppImage documentation notes that electron-builder AppImages do
not contain standard AppImage update information. If delta updates through
`AppImageUpdate` are desired later, extract and repack with `appimagetool -u`
and publish the generated `.zsync` file. This is optional and should not block
the first release; Parson must never replace an existing versioned asset.
