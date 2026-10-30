# syntax=docker/dockerfile:1
# GoShop admin dashboard image. The build context is the repository root,
# the same way Railway builds it:
#
#   docker build -f apps/admin/Dockerfile \
#     --build-arg VITE_API_URL=https://api.example.com -t goshop-admin .
#
# Two kinds of configuration (apps/admin/README.md, artikel 01):
#
# - VITE_API_URL is a build argument: Vite writes it into the JavaScript
#   bundle. It is public, never a secret. One image serves one API; build
#   again for another one. Its origin goes into the CSP at build time too.
# - IMAGE_ORIGIN and UPLOAD_ORIGIN are run-time variables: Caddy reads them
#   when it starts and puts them in the CSP (img-src, connect-src), so the
#   storage can change without a rebuild. The bundle never needs them: the
#   API hands out every photo and upload URL.
#
# The same shape as the Bab 7–10 storefront image
# (git show bab-10:apps/web/Dockerfile): pnpm builds, Caddy serves.

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
COPY apps/admin/ apps/admin/
RUN pnpm install --offline --frozen-lockfile --filter "@goshop/admin..."

ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || { echo "build argument VITE_API_URL is required" >&2; exit 1; }
RUN pnpm --filter @goshop/admin build
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
	&& addgroup -S admin && adduser -S -G admin -H admin \
	&& chown -R admin:admin /data /config
COPY apps/admin/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/api-origin /etc/caddy/api-origin
COPY --from=build /src/apps/admin/dist /srv

# Railway sets PORT; 8080 otherwise. The storage origins are empty until
# the deployment sets them (see above).
ENV PORT=8080 \
	IMAGE_ORIGIN= \
	UPLOAD_ORIGIN=
USER admin:admin
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
