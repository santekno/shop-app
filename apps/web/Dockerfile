# syntax=docker/dockerfile:1
# GoShop storefront image (Bab 11 artikel 14): the Next.js standalone
# server. The build context is the repository root, the same way Railway
# builds it:
#
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t goshop-web .
#
# NEXT_PUBLIC_API_URL is a build argument: Next.js writes it into the
# browser's JavaScript (see apps/web/README.md). It is public, never a
# secret. Everything else (API_INTERNAL_URL, SITE_URL, IMAGE_ORIGIN,
# GA_MEASUREMENT_ID) is read by the server when it starts, so one image
# runs anywhere its build argument fits.

# --- build: install the workspace and build the standalone server ---------
FROM node:24.22.1-alpine AS build
WORKDIR /src
# Corepack installs the pnpm version named in package.json ("packageManager").
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# The lockfile first: `pnpm fetch` downloads every package it names into the
# store, so this layer is reused until pnpm-lock.yaml changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm install --offline --frozen-lockfile --filter "@goshop/web..."

ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || { echo "build argument NEXT_PUBLIC_API_URL is required" >&2; exit 1; }
# output: "standalone" (next.config.ts) writes .next/standalone: server.js
# and only the node_modules it imports, traced from the workspace root, so
# packages/shared is inside too. The hashed browser files (.next/static)
# and public/ are not part of it: the server serves them, but Next.js
# leaves copying them to us, below.
RUN pnpm --filter @goshop/web build

# --- runtime: node and the traced server, nothing else ---------------------
FROM node:24.22.1-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The image's node user (uid 1000) already exists. It owns nothing here
# but .next/cache: the server only reads the rest, and writes the data
# cache (artikel 09) there. Without it every cached fetch fails to reach
# the disk (EACCES in the log) and lives in memory only.
COPY --from=build /src/apps/web/.next/standalone ./
COPY --from=build /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /src/apps/web/public ./apps/web/public
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache

# Railway sets PORT; 8080 otherwise. HOSTNAME is the address server.js
# binds to: Docker sets it to the container's id, which would leave the
# server unreachable on 127.0.0.1 (the health check) and on any other
# interface, so listen on all of them.
ENV PORT=8080 HOSTNAME=0.0.0.0
USER node:node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
	CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "apps/web/server.js"]
