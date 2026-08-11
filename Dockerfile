# syntax=docker/dockerfile:1

# ---------- deps: install server/node_modules with a full build toolchain available,
# in case better-sqlite3/bcrypt don't have a prebuilt binary for this exact base image
# (they usually do, but this keeps the build from failing silently if not) ----------
FROM node:20-slim AS deps
WORKDIR /app/server
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------- runtime: lean image, no build toolchain ----------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# server/server.js serves the whole repo as static files (css/, js/, auth/, lobby/,
# index.html, solo.html) in addition to running the API/WebSocket layer — see its
# `projectRoot` — so the image needs the entire project tree, not just server/.
COPY . .
# Overlay the Linux-built node_modules from the deps stage — the host's own
# server/node_modules (Windows/whatever-arch binaries) is excluded via .dockerignore,
# so this is the only node_modules that ends up in the image.
COPY --from=deps /app/server/node_modules ./server/node_modules

# Run as a non-root user. server/db.js creates server/data/app.db itself
# (mkdirSync + better-sqlite3) on first boot, so that directory just needs to exist
# and be writable — it's also where a Fly volume should be mounted for persistence.
RUN useradd --system --create-home appuser \
    && mkdir -p /app/server/data \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 5500
WORKDIR /app/server
CMD ["node", "server.js"]
