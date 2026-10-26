# syntax=docker/dockerfile:1
# GoShop storefront image. The build context is the repository root, the
# same way Railway builds it:
#
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t goshop-web .
#
# VITE_API_URL is a build argument, not a run-time variable: Vite writes it
# into the JavaScript bundle (see apps/web/README.md). It is public, never a
# secret. One image therefore serves one API; build again for another one.

# --- build: install the workspace and bundle the app ----------------------
FROM node:24.22.1-alpine AS build
WORKDIR /src
# Corepack installs the pnpm version named in package.json ("packageManager").
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# The lockfile first: `pnpm fetch` downloads every package it names into the
# store, so this layer is reused until pnpm-lock.yaml changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm install --offline --frozen-lockfile --filter "@goshop/web..."

ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || { echo "build argument VITE_API_URL is required" >&2; exit 1; }
RUN pnpm --filter @goshop/web build
# The API's origin (scheme, host and port, no path) for the Caddyfile's
# Content-Security-Policy. new URL also fails the build on a malformed URL.
RUN node -e 'process.stdout.write(new URL(process.env.VITE_API_URL).origin)' > /src/api-origin

# --- runtime: Caddy serving static files ----------------------------------
FROM caddy:2.11.7-alpine
# Caddy keeps state under /data and /config; give them to an unprivileged
# user. The binary's file capability (bind to ports below 1024) is removed:
# we listen on $PORT, and a non-root process cannot use it anyway.
RUN apk add --no-cache libcap \
	&& setcap -r /usr/bin/caddy \
	&& apk del libcap \
	&& addgroup -S web && adduser -S -G web -H web \
	&& chown -R web:web /data /config
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/api-origin /etc/caddy/api-origin
COPY --from=build /src/apps/web/dist /srv

# Railway sets PORT; 8080 otherwise.
ENV PORT=8080
USER web:web
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
