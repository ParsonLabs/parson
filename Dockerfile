# Stage 1: Build the React frontend
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
FROM rust:1.76 AS backend-builder
WORKDIR /usr/src

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev wget make build-essential pkg-config libssl-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN wget https://www.nasm.us/pub/nasm/releasebuilds/2.16/nasm-2.16.tar.gz \
    && tar xzf nasm-2.16.tar.gz \
    && cd nasm-2.16 \
    && ./configure \
    && make \
    && make install \
    && cd .. \
    && rm -rf nasm-2.16 nasm-2.16.tar.gz
    
RUN cargo install diesel_cli@2.1.1 --no-default-features --features sqlite

COPY ./crates/backend /usr/src/crates/backend
COPY ./diesel.toml /usr/src/diesel.toml
COPY --from=installer /app/apps/web/out /usr/src/apps/web/out

WORKDIR /usr/src/crates/backend

ENV DATABASE_URL=sqlite:///usr/src/crates/backend/music.db

RUN diesel migration run --config-file /usr/src/diesel.toml

RUN cargo build --release

# Stage 4: Create the final image
FROM debian:bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    sqlite3 \
    libsqlite3-dev \
    wget \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy files as root
COPY --from=backend-builder /usr/src/crates/backend/target/release/music-server /usr/local/bin/music-server
COPY --from=backend-builder /usr/src/crates/backend/music.db /usr/src/crates/backend/music.db
COPY --from=installer /app/apps/web/out ./apps/web/out

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV RUNNING_IN_DOCKER=true

EXPOSE 1993
EXPOSE 7700

CMD ["/usr/local/bin/music-server", "--port", "1993"]