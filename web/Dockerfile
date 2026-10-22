# syntax=docker/dockerfile:1

# strengthmaxxing web (SvelteKit + adapter-node)
#
# The main risk here is the native module `better-sqlite3`: it must be COMPILED
# for this exact image (node ABI + glibc) at build time, and its compiled
# `.node` binary must survive into the runtime image. We keep `node_modules`
# from the builder stage (which already contains the built native addon) rather
# than re-installing at runtime, so the compiled artifact is guaranteed present.
# `vite.config.ts` marks better-sqlite3 as `ssr.external`, so it is NEVER
# bundled — it is `require()`d from node_modules at runtime. That is why the
# production node_modules must ship in the runtime image.

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Toolchain for compiling better-sqlite3 (node-gyp: python3 + make + g++).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# corepack ships with node 22 and pins the pnpm version.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate

# Install deps first (better docker layer caching). The build context is ./web,
# so the lockfile and the pnpm-workspace.yaml (which whitelists better-sqlite3 &
# esbuild via allowBuilds) are both at the context root.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# Build the app -> produces ./build (adapter-node).
COPY . .
RUN pnpm build

# Strip devDependencies but keep the compiled better-sqlite3 native addon.
# `pnpm prune --prod` rewrites node_modules to production-only while preserving
# the already-built native binaries.
RUN pnpm prune --prod

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# adapter-node reads PORT/HOST; default app port is 3000.
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy the built server, production node_modules (incl. the compiled
# better-sqlite3 .node), and package.json (adapter-node resolves deps at runtime).
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Migrations are applied at boot from ./drizzle (hooks.server.ts) — must ship too.
COPY --from=builder /app/drizzle ./drizzle

# /data is the sqlite volume mountpoint. Creating it here owned by `node` makes
# a FRESH named volume inherit node:node (docker copies the image dir's
# ownership on first use). Bind mounts don't get this — chown those to uid 1000
# on the host (see deploy/README.md).
RUN mkdir -p /data && chown node:node /data

# Run as the built-in unprivileged `node` user.
USER node

EXPOSE 3000
CMD ["node", "build"]
