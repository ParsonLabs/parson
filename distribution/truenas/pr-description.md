# TrueNAS Apps PR

Suggested title:

```text
Add Parson to the community train
```

Suggested description to review and adapt:

```text
## Description

Adds Parson, a GPL-3.0-only, self-hosted and local-first music server/player.
The app uses the upstream GHCR image, runs as non-root UID/GID 10001, persists
/Parson, mounts /music read-only by default, and exposes a configurable WebUI
port (1993 by default).

## App information

- Source: https://github.com/ParsonLabs/parson
- Documentation: https://parson.dev/docs
- Release: https://github.com/ParsonLabs/parson/releases/tag/v1.0.0
- Container: ghcr.io/parsonlabs/parson-music:1.0.0
- License: GPL-3.0-only

## Testing

- [ ] Rendered with basic-values.yaml
- [ ] Container reaches healthy state
- [ ] First-run administrator setup succeeds
- [ ] /music can be registered and scanned
- [ ] Browser playback works
- [ ] Restart preserves data
- [ ] Upgrade preserves data
- [ ] Uninstall does not remove the user's host music dataset

## Icons and screenshots

- Icon source: apps/web/public/icons/icon.svg in the upstream repository
- Screenshots: apps/site/public/screenshots/ in the upstream repository
```

Use the current PR template from `truenas/apps` when submitting; it remains the
source of truth and may add fields after this draft was prepared.
