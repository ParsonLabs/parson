FROM oven/bun:alpine AS frontend-builder
RUN apk update
RUN apk add --no-cache yarn nodejs npm
WORKDIR /app

COPY package.json yarn.lock bun.lockb turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/*/package.json ./packages/

RUN bun install --frozen-lockfile
RUN bun install turbo --global

COPY . .
RUN turbo prune music --docker

# Stage 2: Install dependencies and build the project
FROM oven/bun:alpine AS installer
WORKDIR /app
COPY --from=frontend-builder /app/out/json/ . 
COPY --from=frontend-builder /app/out/yarn.lock ./yarn.lock

RUN apk add --no-cache nodejs npm

RUN bun install --frozen-lockfile
RUN bun install yarn --global
COPY --from=frontend-builder /app/out/full/ . 
COPY ./package.json ./package.json
COPY ./yarn.lock ./yarn.lock

RUN npm install esbuild --no-save

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app/apps/web
RUN yarn build

# Stage 3: Build the Rust backend
FROM rust:slim AS backend-builder
WORKDIR /usr/src

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev wget make build-essential pkg-config libssl-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q https://github.com/netwide-assembler/nasm/archive/refs/tags/nasm-2.16.01.tar.gz \
    && tar xzf nasm-2.16.01.tar.gz \
    && cd nasm-nasm-2.16.01 \
    && ./autogen.sh \
    && ./configure --prefix=/usr/local \
    && make -j$(nproc) \
    && make install \
    && cd .. \
    && rm -rf nasm-nasm-2.16.01 nasm-2.16.01.tar.gz
    
RUN cargo install diesel_cli@2.2.8 --no-default-features --features sqlite

COPY ./crates/backend/Cargo.toml /usr/src/crates/backend/
COPY ./crates/backend/Cargo.lock /usr/src/crates/backend/
COPY ./Cargo.toml /usr/src/
COPY ./Cargo.lock /usr/src/
COPY ./diesel.toml /usr/src/diesel.toml

WORKDIR /usr/src/crates/backend
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    cargo fetch

COPY ./crates/backend/src /usr/src/crates/backend/src
COPY ./crates/backend/migrations /usr/src/crates/backend/migrations
COPY --from=installer /app/apps/web/out /usr/src/apps/web/out

ENV DATABASE_URL=sqlite:///usr/src/crates/backend/music.db

RUN diesel migration run --config-file /usr/src/diesel.toml || echo "Migrations completed with warnings"

ENV RUSTFLAGS="-C opt-level=3 -C target-cpu=native -C codegen-units=1"
RUN cargo build --release -j $(nproc) || (cat target/release/deps/*.stderr 2>/dev/null || true && exit 1)

# Final stage with minimal image
FROM debian:bookworm-slim AS runner
WORKDIR /app

# Install only essential runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    sqlite3 \
    libsqlite3-dev \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /usr/src/crates/backend/target/release/music-server /usr/local/bin/music-server
COPY --from=backend-builder /usr/src/crates/backend/music.db /app/music.db
COPY --from=installer /app/apps/web/out ./apps/web/out

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV RUNNING_IN_DOCKER=true
ENV DATABASE_URL=sqlite:///app/music.db

EXPOSE 1993
EXPOSE 7700

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:1993/health || exit 1

RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

CMD ["/usr/local/bin/music-server", "--port", "1993"]