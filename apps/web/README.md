# apps/web — GoShop storefront

The storefront for buyers: a Vite + React 19 + TypeScript single-page app. In Bab 7 it has one page, the category list from `GET /v1/categories`, loaded through the typed client in `packages/shared`.

## Run it

```bash
nvm use                                   # Node 24, from .nvmrc
pnpm install
make up                                   # or: make dev-api, with postgres and redis running
pnpm --filter @goshop/web dev             # http://localhost:5173
```

Open **http://localhost:5173**, not `127.0.0.1:5173`: the API's CORS default (`APP_CORS_ALLOWED_ORIGINS=http://localhost:5173`) allows that exact origin, and the dev server refuses to move to another port (`strictPort`).

`make up` also starts the built storefront (the `web` service) on the same port 5173, so stop it (`docker compose stop web`) before `pnpm dev`, or use the container instead of the dev server.

The Playwright suite in `e2e/` expects the example catalog from `make seed`: `make test-integration` seeds first, so run `make seed` yourself before running the suite against your own `make up` (without it, the page shows "Belum ada kategori.").

| Script      | What it does                                                                          |
| ----------- | ------------------------------------------------------------------------------------- |
| `dev`       | Vite dev server with hot reload                                                       |
| `typecheck` | `tsc -b`: the app (browser) and `vite.config.ts` (Node)                               |
| `format`    | `prettier --write` and `eslint --fix`                                                 |
| `lint`      | ESLint (no warnings allowed) and `prettier --check`                                   |
| `build`     | Production bundle in `dist/`; needs `VITE_API_URL`                                    |
| `test:unit` | Vitest, in a jsdom environment                                                        |
| `preview`   | Serves `dist/` on port 4173 (not a CORS-allowed origin; for checking the bundle only) |

## Configuration: `VITE_API_URL`

The only setting is the API's public URL, as the **browser** reaches it.

Vite replaces `import.meta.env.VITE_API_URL` with its value **at build time**: the URL ends up inside the JavaScript files. So:

- it is public, and never a secret: every visitor can read it;
- changing it means building again. One image serves one API.

| Where                      | How it is set                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                 | `apps/web/.env.local` (copy `.env.example`); unset means `http://localhost:8080`                                              |
| `pnpm build`, `make build` | the environment; `make build` uses `http://localhost:8080` unless you set it. `vite build` stops when it is missing           |
| `docker build`             | `--build-arg VITE_API_URL=https://api.example.com`; the build stops when it is missing                                        |
| `make up` / Compose        | `VITE_API_URL` in your shell or the root `.env`, default `http://localhost:8080`                                              |
| Railway                    | a service variable `VITE_API_URL` on the web service: Railway passes service variables to the Docker build as build arguments |

We chose a build argument over a run-time `config.js` written at container start: it needs no start script and no second place to read configuration from, and Railway rebuilds on every deploy anyway. Its cost is one image per API URL, which is how GoShop deploys (one Railway service per environment).

## Container

`apps/web/Dockerfile` (repo root as context) builds with pnpm on `node:24-alpine`, then serves `dist/` with Caddy (`apps/web/Caddyfile`) as a non-root user, listening on `$PORT` (8080 by default; Railway sets it). Caddy:

- answers `GET /healthz` with `ok` (Docker `HEALTHCHECK`, Railway health check), without touching a file;
- serves `/assets/` (the hashed files) with a one-year cache, and answers a missing one with a plain 404, never with `index.html`;
- sends the file for any other path that has one, otherwise `index.html`, so client-side routes work; both are revalidated on every visit;
- sets the same security headers on every response, errors included: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, a `Permissions-Policy` that turns off camera, microphone, geolocation and payment, and a Content-Security-Policy whose `connect-src` is the API's **origin**.

The CSP uses the origin of `VITE_API_URL` (scheme, host and port: `https://api.example.com/base/` becomes `https://api.example.com`), because a CSP source with a path allows only that exact path. The Dockerfile computes it with `new URL(…).origin` at build time, which also rejects a malformed URL, and Caddy reads it from `/etc/caddy/api-origin`.

There is no `Strict-Transport-Security` header: Caddy serves plain HTTP behind Railway's edge, which terminates TLS. HSTS belongs to the layer that serves HTTPS, so it is set there (with the custom domain), not by this container.

```bash
docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=http://localhost:8080 -t goshop-web .
docker run --rm -e PORT=8080 -p 127.0.0.1:5173:8080 goshop-web
```

## Layout

```
src/
├── main.tsx                       # mounts <App /> in StrictMode
├── config.ts                      # VITE_API_URL, checked once
├── app/App.tsx                    # page layout
├── lib/
│   ├── api.ts                     # the one API client (packages/shared)
│   └── error-message.ts           # ApiError → Indonesian text
└── features/catalog/
    ├── hooks/useCategoryTree.ts   # load, abort on unmount, reload
    └── components/                # CategorySection, CategoryTree
```

`@/…` is an alias for `src/…` (`tsconfig.app.json` `paths` and `vite.config.ts` `resolve.alias`).
