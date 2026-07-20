# Parson 1.0.0

Parson is a self-hosted, local-first music server and player for your own music
collection. This is the first stable release.

## Downloads

- Windows desktop: `Parson_1.0.0_x64-setup.exe`
- Linux desktop: `Parson_1.0.0_x86_64.AppImage` and `.deb` (use the filenames
  attached below if electron-builder emits a different architecture label)
- Windows headless server: `ParsonMusicServer-1.0.0-win-x64.zip`
- Container: `ghcr.io/parsonlabs/parson-music:1.0.0`

Verify Linux downloads with the attached `SHA256SUMS`. Windows binaries should
show the reviewed ParsonLabs Authenticode publisher before installation.

## Highlights

- Browse, search, and play a local music library
- Albums, artists, genres, lyrics, playlists, likes, history, and queue playback
- Desktop player with an embedded local server
- Web access and trusted-LAN discovery for other devices
- Self-hosted accounts and data with no Parson cloud dependency
- Container image for server and NAS deployments

## First run

Install or start Parson, open the setup flow, create the local administrator,
and choose your music folder. Container users should persist `/Parson`, mount
their library at `/music`, expose port 1993, and select `/music` during setup.

Documentation: https://parson.dev/docs
