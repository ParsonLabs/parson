FROM --platform=$BUILDPLATFORM oven/bun:1.3.14-alpine AS bun-runtime

FROM --platform=$BUILDPLATFORM node:24-alpine AS web-deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

COPY package.json bun.lock turbo.json ./
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY apps/mobile/patches ./apps/mobile/patches
COPY apps/site/package.json ./apps/site/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages
RUN bun install --frozen-lockfile --ignore-scripts

COPY apps/web ./apps/web

FROM web-deps AS web-builder
RUN bun --filter parson-music-web build

FROM rust:1.97-slim-trixie AS backend-builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends nasm \
  && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates/backend ./crates/backend
COPY crates/parson-core ./crates/parson-core
COPY crates/windows-bridge ./crates/windows-bridge
COPY crates/windows-server ./crates/windows-server
COPY --from=web-builder /app/apps/web/out ./apps/web/out
RUN cargo build --release -p parson-music

FROM debian:trixie-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 parson \
  && install -d -o parson -g parson /Parson

COPY --from=backend-builder /app/target/release/parson-music-server /usr/local/bin/parson-music-server

ENV RUNNING_IN_DOCKER=true
ENV PARSON_PORT=1993
EXPOSE 1993
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:1993/health || exit 1
USER parson

ENTRYPOINT ["/usr/local/bin/parson-music-server"]
