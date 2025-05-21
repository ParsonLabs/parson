<p align="center">
  <img src="https://avatars.githubusercontent.com/u/138057124?s=200&v=4" />
</p>
<h1 align="center">ParsonLabs Music</h1>

<p align="center">
  <img src="https://www.pwa-shields.com/1.0.0/series/certified/purple.svg" alt="PWA Shields" height="20">
</p>

<h4 align="center">
  <a href="#get-started">Install</a>
  ·
  <a href="https://docs.parsonlabs.com/">Documentation</a>
  ·
  <a href="https://github.com/WillKirkmanM/music/releases">Releases</a>
</h4>

<p align="center">ParsonLabs Music is the Self Hosted Audio streaming alternative to YouTube Music, Spotify & Apple Music, providing Unrestricted Access to your library in Uncompressed, Lossless Quality</p>

<img width="1280" alt="Home Page" src="https://github.com/user-attachments/assets/24ac1681-30e3-4570-9501-e0faab259bd9" />
<img width="1280" alt="Album Showcase" src="https://github.com/user-attachments/assets/361b7f64-cee3-4571-a7ff-b12718476a70" />

## Get Started

### Docker

#### Docker Run
```sh
docker run -d \
  --name parsonlabs-music \
  -p 1993:1993 \
  -v "/path/to/config:/ParsonLabsMusic" \
  -v "/path/to/music:/music" \
  --restart unless-stopped \
  ghcr.io/willkirkmanm/music
```

#### Docker Compose
```yaml
services:
  music-server:
    image: ghcr.io/willkirkmanm/music
    container_name: parsonlabs-music
    ports:
      - "1993:1993"
    volumes:
      - "/path/to/config:/ParsonLabsMusic"
      - "/path/to/music:/music"
    restart: unless-stopped
```

### Download Precompiled Binaries

You can download the precompiled binaries from the [releases page](https://github.com/WillKirkmanM/music/releases).

- [Windows (x86_64)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-x86_64-pc-windows-gnu.zip)
- [Linux (x86_64)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-x86_64-unknown-linux-gnu.tar.gz)
- [Linux (x86_64 MUSL)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-x86_64-unknown-linux-musl.tar.gz)
- [Linux (ARMv7 gnueabihf)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-armv7-unknown-linux-gnueabihf.tar.gz)
- [Linux (ARMv7 MUSL)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-armv7-unknown-linux-musleabihf.tar.gz)
- [Linux (ARM gnueabihf)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-arm-unknown-linux-gnueabihf.tar.gz)
- [Linux (ARM MUSL)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-arm-unknown-linux-musleabihf.tar.gz)
- [Linux (ARM64)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-aarch64-unknown-linux-gnu.tar.gz)
- [Linux (ARM64 MUSL)](https://github.com/WillKirkmanM/music/releases/download/v1.6.0-alpha/music-server-aarch64-unknown-linux-musl.tar.gz)

### Compile From Source

### One Liner
```
git clone https://github.com/WillKirkmanM/music && cd music && OS=$(uname -s) && if [ "$OS" = "Linux" ]; then if [ -f /etc/debian_version ]; then sudo apt-get update && sudo apt-get install -y --no-install-recommends sqlite3 libsqlite3-dev wget make build-essential pkg-config libssl-dev unzip && wget https://www.nasm.us/pub/nasm/releasebuilds/2.16/nasm-2.16.tar.gz && tar xzf nasm-2.16.tar.gz && cd nasm-2.16 && ./configure && make && sudo make install && cd .. && rm -rf nasm-2.16 nasm-2.16.tar.gz && sudo apt-get install -y libssl1.1 && rm -rf /var/lib/apt/lists/* && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn; elif [ -f /etc/arch-release ]; then sudo pacman -Syu --noconfirm sqlite wget make base-devel pkgconf openssl nasm unzip && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn; elif [ -f /etc/fedora-release ]; then sudo dnf install -y sqlite sqlite-devel wget make gcc gcc-c++ kernel-devel pkgconf-pkg-config openssl-devel nasm unzip && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn; elif [ -f /etc/gentoo-release ]; then sudo emerge --sync && sudo emerge --ask sqlite wget make gcc pkgconfig openssl nasm unzip && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn; else echo "Unsupported Linux distribution" && exit 1; fi; else echo "Unsupported OS" && exit 1; fi && bun run build --filter music && cargo build --package music-server --release && cargo run --package music-server --release
```

### Clone the Repository
```
git clone https://github.com/WillKirkmanM/music
```

### Install Dependencies
#### Ubuntu
```
sudo apt-get update && apt-get install -y --no-install-recommends sqlite3 libsqlite3-dev wget make build-essential pkg-config libssl-dev unzip && wget https://www.nasm.us/pub/nasm/releasebuilds/2.16/nasm-2.16.tar.gz && tar xzf nasm-2.16.tar.gz && cd nasm-2.16 && ./configure && make && make install && cd .. && rm -rf nasm-2.16 nasm-2.16.tar.gz && apt-get install -y libssl1.1 && rm -rf /var/lib/apt/lists/* && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn
```
#### Arch Linux
```
sudo pacman -Syu --noconfirm sqlite wget make base-devel pkgconf openssl nasm unzip && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn
```
#### Fedora
```
sudo dnf install -y sqlite sqlite-devel wget make gcc gcc-c++ kernel-devel pkgconf-pkg-config openssl-devel nasm unzip && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn
```

#### Gentoo
```
sudo emerge --sync && sudo emerge --ask sqlite wget make gcc pkgconfig openssl nasm unzip && curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install --global yarn
```

### Build the Website
```
bun run build --filter music 
```
### Run the Server
```
cargo run --package music-server --release -- -p 1993
```

> [!NOTE]  
> **Done! 🥳**.
> Head to [http://localhost:1993/](http://localhost:1993/) and setup your music library.

## Documentation
<p align="center">
  Any additional troubleshooting information can be found in the Documentation https://docs.parsonlabs.com.
</p>

![documentation](https://github.com/user-attachments/assets/94dd3cda-0a4b-4536-82b9-9d341360b8e1)
