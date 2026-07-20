# Unraid Community Apps submission

`repository/` is a complete standalone Community Apps repository payload based
on Unraid's current official starter. Review it, then place its contents at the
root of a public repository. The prepared raw URLs assume:

```text
https://github.com/ParsonLabs/unraid-templates
```

If you choose another name, replace that URL in `ca_profile.xml` and
`templates/parson.xml` before publishing.

## Before submission

1. Confirm `ghcr.io/parsonlabs/parson-music:latest` and the immutable `:1.0.0`
   tag are public and start successfully on amd64.
2. Review the GPL license, profile copy, icon, paths, and template XML.
3. Test the template on Unraid. Confirm `/mnt/user/appdata/parson` is writable by
   container UID/GID `10001:10001`; fix ownership if necessary.
4. Confirm the WebUI opens on `http://<server>:1993` and `/health/ready` is ready.
5. Use https://ca.unraid.net/submit/new to run Validate and Scan after every XML
   change, then submit the public repository URL for review.

The template mounts music read-only by default and does not use privileged mode
or host networking. The user may change the host music path during install.
