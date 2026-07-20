# Parson for Unraid

Community Applications template for
[Parson](https://github.com/ParsonLabs/parson), a self-hosted, local-first music
server and player.

The container stores its database and settings under `/Parson`, reads music from
`/music`, and serves the WebUI on port 1993. It runs as UID/GID `10001:10001`.

After installation, open the WebUI and register `/music` as the library folder.
For support, use the upstream GitHub issue tracker.
