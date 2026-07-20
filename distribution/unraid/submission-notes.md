# Unraid submission notes

Repository URL expected by the prepared XML:

```text
https://github.com/ParsonLabs/unraid-templates
```

Review summary:

```text
Parson is a GPL-3.0-only, self-hosted, local-first music server and player. The
template uses the public upstream GHCR image, bridge networking, a configurable
1993/tcp WebUI port, persistent /Parson storage, and a read-only /music mount.
It is unprivileged and does not mount the Docker socket or other host devices.
Support is provided through the upstream GitHub issue tracker.
```

In https://ca.unraid.net/submit/new, provide the repository URL, run Validate,
run Scan, inspect the rendered listing, resolve every warning, and only then
submit it for review. The portal is the current source of truth for any fields
not captured in this file.
