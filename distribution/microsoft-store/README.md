# Microsoft Store submission

Use the existing NSIS `.exe` submission route. It is less disruptive than
introducing MSIX for the first release and is explicitly supported by the Store.

## Package fields

| Partner Center field        | Value                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Package URL                 | `https://github.com/ParsonLabs/parson/releases/download/v1.0.0/Parson_1.0.0_x64-setup.exe` |
| Architecture                | x64                                                                                        |
| Language                    | English (`en`)                                                                             |
| App type                    | EXE                                                                                        |
| Silent installer parameters | `/S`                                                                                       |
| Installer type              | Standalone/offline NSIS installer                                                          |
| Pricing                     | Free                                                                                       |
| Category                    | Music                                                                                      |
| Support                     | `https://github.com/ParsonLabs/parson/issues`                                              |
| Website                     | `https://parson.dev`                                                                       |
| Privacy policy              | `https://parson.dev/docs/accounts-privacy-security#privacy`                                |

GitHub release URLs are versioned and HTTPS, but the installer must be signed
before it is uploaded. The URL must remain immutable after Store submission.

## Assets

Upload at least one screenshot; four or more are recommended. Review and use the
seven existing 2880×1620 product screenshots under
`apps/site/public/screenshots/`. The Store permits up to ten. A 1:1 Store logo is
also required; use the existing 512×512
`apps/web/public/images/brand/parson-logo-512.png`. The 2:3 poster artwork is
recommended but optional. Do not upscale a small raster source just to create
optional artwork.

## Certification notes

Use the text in `listing-en-US.md`. Tell certification that Parson is a local-
first music server/player, starts an embedded backend on TCP port 1993, and asks
the user to select their own music directory during setup. A normal reviewer can
test with any non-DRM audio files. No Parson cloud account or payment is needed.

Before submission, verify all PE files inside the installed application and the
installer itself are Authenticode-signed with the same reviewed publisher. A
self-signed certificate is not sufficient for this submission route.
