# Release and submission runbook

## One-time decisions and credentials

- [ ] Review the name `Parson`, publisher `ParsonLabs`, descriptions, screenshots,
      privacy statement, support URL, and license claims.
- [ ] Create or use a Microsoft Partner Center developer account and reserve the
      product name. Do this yourself; no automation in this repository creates an
      account or product.
- [ ] Obtain a Windows Authenticode signing identity whose certificate chains to
      a CA in the Microsoft Trusted Root Program. Store MSI/EXE submissions require
      the installer and every PE file inside it to be signed.
- [ ] Add the signing material to GitHub Actions using the electron-builder
      `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` secret names, or sign the release on
      a secured Windows machine. `WIN_CSC_LINK` accepts a base64-encoded PFX. Never
      commit the certificate or password.
- [ ] Decide where the Unraid catalog files will live. The prepared directory is
      designed to become a small public repository such as
      `ParsonLabs/unraid-templates`; update its raw URLs if you choose another name.
- [ ] Human-only: decide whether to pursue Flathub after reading
      `flathub/README.md` and its current generative-AI policy.

## Pre-tag checks

- [ ] Confirm `package.json`, `apps/desktop/package.json`, and Cargo package
      versions all describe `1.0.0` where appropriate.
- [ ] Confirm the GHCR workflow publishes both `latest` and `1.0.0` for a
      `v1.0.0` tag.
- [ ] Run `bun install --frozen-lockfile`.
- [ ] Run the repository verify workflow locally where practical.
- [ ] Run `./distribution/scripts/validate.sh`.
- [ ] Build and smoke-test the container on amd64.
- [ ] Build Windows on a clean Windows runner with signing enabled; verify every
      `.exe` with `Get-AuthenticodeSignature` or `signtool verify /pa /all`.
- [ ] Test both interactive install and silent install (`/S`) in Windows Sandbox,
      then test silent uninstall.
- [ ] Build and run the AppImage on at least one supported Linux distribution.

## Publish the immutable upstream artifacts

- [ ] Push the reviewed `v1.0.0` tag. The existing release workflow builds the
      Windows installer, AppImage, DEB, checksums, and GHCR image.
- [ ] Confirm the GitHub release contains exactly one
      `Parson_1.0.0_x64-setup.exe` and one `Parson_1.0.0_x86_64.AppImage` (electron-
      builder may report `x64` for the AppImage; use the actual filename everywhere).
- [ ] Confirm `SHA256SUMS` matches downloaded Linux assets.
- [ ] Confirm `ghcr.io/parsonlabs/parson-music:1.0.0` is public, immutable, amd64,
      and passes `/health/ready` after startup.
- [ ] Do not replace files behind a published version URL. Issue `1.0.1` instead.

## Distribution order

1. AppImage: the GitHub release is the distribution channel.
2. WinGet: generate final manifests from the signed release installer and submit
   one PR to `microsoft/winget-pkgs`.
3. Microsoft Store: enter the prepared listing and immutable installer URL in
   Partner Center, complete the age rating questionnaire, and submit.
4. Unraid: publish the prepared standalone repository, run Validate and Scan in
   the Community Apps portal, and submit the repository URL.
5. TrueNAS: copy the prepared app into a current `truenas/apps` fork, update its
   catalog library version/hash using their tooling, test it, and open a draft PR.
6. Flathub: complete only through a human-authored workflow that complies with
   Flathub's policy.

## Official references checked 2026-07-20

- Microsoft Store MSI/EXE requirements:
  https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements
- Microsoft Store package fields:
  https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/upload-app-packages
- WinGet manifest authoring and submission:
  https://learn.microsoft.com/windows/package-manager/package/manifest
  and https://learn.microsoft.com/windows/package-manager/package/repository
- Flathub requirements and submission:
  https://docs.flathub.org/docs/for-app-authors/requirements and
  https://docs.flathub.org/docs/for-app-authors/submission
- AppImage packaging and updates:
  https://docs.appimage.org/packaging-guide/manual.html and
  https://docs.appimage.org/packaging-guide/optional/updates.html
- TrueNAS Apps contributor guide:
  https://github.com/truenas/apps/blob/master/CONTRIBUTIONS.md
- Unraid Community Apps submission docs:
  https://ca.unraid.net/submit/help
