FROM oven/bun:alpine AS frontend-builder
 RUN apk update
 RUN apk add --no-cache yarn
 WORKDIR /app
 COPY . .
 
 RUN bun install --ignore-scripts
 RUN bun install turbo --global
 RUN turbo prune music --docker
 
 # Stage 2: Install dependencies and build the project
 FROM oven/bun:alpine AS installer
 WORKDIR /app
 COPY --from=frontend-builder /app/out/json/ . 
 COPY --from=frontend-builder /app/out/yarn.lock ./yarn.lock
 
 RUN bun install --ignore-scripts
 RUN bun install yarn --global
 RUN apk add --no-cache nodejs-current
 COPY --from=frontend-builder /app/out/full/ . 
 COPY ./package.json ./package.json
 COPY ./yarn.lock ./yarn.lock
 
 WORKDIR /app/apps/web
 
 RUN yarn build
 
 # Stage 3: Build the Rust backend
 FROM rust:1.79-bookworm-slim AS backend-builder
 WORKDIR /usr/src
 
 RUN apt-get update && apt-get install -y --no-install-recommends \
     sqlite3 libsqlite3-dev \
     pkg-config libssl-dev \
     ffmpeg \
     nasm \
     wget \
     autoconf \
     automake \
     build-essential \
     libtool \
     && rm -rf /var/lib/apt/lists/*
 
RUN wget -q https://github.com/netwide-assembler/nasm/archive/refs/tags/nasm-2.16.01.tar.gz \
    && tar xzf nasm-2.16.01.tar.gz \
    && cd nasm-nasm-2.16.01 \
    && ./autogen.sh \
    && ./configure --prefix=/usr/local \
    && make -j"$(nproc)" \
    && touch nasm.1 \
    && touch ndisasm.1 \
    && make install \
    && cd .. \
    && rm -rf nasm-nasm-2.16.01 nasm-2.16.01.tar.gz
 
 RUN cargo install diesel_cli@2.2.8 --no-default-features --features sqlite
 
 COPY ./crates/backend /usr/src/crates/backend
 COPY ./diesel.toml /usr/src/diesel.toml
 COPY --from=installer /app/apps/web/out /usr/src/apps/web/out
 
 WORKDIR /usr/src/crates/backend
 
 ENV DATABASE_URL=sqlite:///usr/src/crates/backend/music.db
 
 RUN diesel migration run --config-file /usr/src/diesel.toml || echo "Migrations completed with warnings"
 
 RUN RUSTFLAGS="-C opt-level=3" cargo build --release || (cat target/release/deps/*.stderr 2>/dev/null || true && exit 1)
 
 FROM debian:bookworm-slim AS runner
 WORKDIR /app
 
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