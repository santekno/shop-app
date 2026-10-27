# apps/web — GoShop storefront

The storefront for buyers: a Vite + React 19 + TypeScript single-page app. Bab 7 set it up with one page, the category list. Bab 8 added the catalog and the product page in plain React. Bab 9 adds pages with React Router (`/`, `/produk/:slug`, `/keranjang`, `/masuk`, `/daftar`, a 404), server data with TanStack Query, a guest cart, and the login and registration forms with React Hook Form and Zod. Bab 10 restyles it with Tailwind CSS and shadcn/ui, keeps the guest cart in a Zustand store, and keeps the buyer logged in across reloads with an httpOnly refresh cookie. `docs/web/README.md` maps every chapter to the code.

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

Before the suite runs, its global setup (`e2e/support/global-setup.ts`) writes to the Compose project it tests, never anywhere else: it clears the API's rate-limit counters (`goshop:rl:*` in Redis), registers the e2e buyer `e2e-buyer@goshop.local` through `POST /v1/auth/register`, and marks it verified with `psql` in the Compose Postgres.

| Script      | What it does                                                                          |
| ----------- | ------------------------------------------------------------------------------------- |
| `dev`       | Vite dev server with hot reload                                                       |
| `typecheck` | `tsc -b`: the app (browser) and `vite.config.ts` (Node)                               |
| `format`    | `prettier --write` and `eslint --fix`                                                 |
| `lint`      | ESLint (no warnings allowed) and `prettier --check`                                   |
| `build`     | Production bundle in `dist/`; needs `VITE_API_URL`                                    |
| `test:unit` | Vitest, in a jsdom environment                                                        |
| `preview`   | Serves `dist/` on port 4173 (not a CORS-allowed origin; for checking the bundle only) |

## The web session locally (Bab 10)

Logging in sets an httpOnly refresh cookie, `goshop_refresh`, that the browser sends back to `/v1/auth/web/*` by itself; a reload restores the session from it ([ADR 0008](../../docs/adr/0008-web-session-cookie.md)). Three things must line up, or the storefront silently behaves as if nobody were logged in:

1. **The storefront's origin is in the API's `APP_CORS_ALLOWED_ORIGINS`**, exactly (scheme, host, port; no trailing slash). The web endpoints refuse any other `Origin` with `403 FORBIDDEN` (`details.reason: origin`), and CORS allows credentials only for listed origins. The default, `http://localhost:5173`, matches `pnpm dev`. Running the dev server on another port, or a second stack, means adding that origin: for example `APP_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:34173`.
2. **The storefront and the API are the same site.** `SameSite=Strict` cookies travel only between hosts of one registrable domain. `localhost:5173` → `localhost:8080` is one site (ports do not count). Use `localhost` for both, never `localhost` for one and `127.0.0.1` for the other: those are two sites, and the cookie is never sent. In a deployment this means custom domains under one domain (`shop.example.com` and `api.example.com`); Railway's generated `*.up.railway.app` hosts are separate sites (`docs/configuration.md`).
3. **The browser keeps a `Secure` cookie.** The API sets `Secure` by default (`APP_AUTH_COOKIE_SECURE=true`). Chromium and Firefox treat `http://localhost` as a secure context and keep the cookie, so `make up`, `pnpm dev` and the e2e suite need nothing. Set `APP_AUTH_COOKIE_SECURE=false` (accepted only with `APP_ENV=development`) only for a browser that is not in a secure context, such as a phone opening `http://192.168.x.x:5173` over the LAN, or a browser that does not extend the localhost exception to cookies. Note that such a page also has no Web Locks API (`navigator.locks` exists only in a secure context), so two of its tabs can still race a refresh (see `features/auth/refresh-lock.ts`).

To check it: log in, then DevTools → Application → Cookies → `http://localhost:8080` shows `goshop_refresh` with `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/v1/auth/web`; Local Storage and Session Storage hold no token (only `goshop:cart` and `goshop:theme`). A reload keeps you logged in, and the Network panel shows one `POST /v1/auth/web/refresh` per page load (`204` when logged out).

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
├── app/
│   ├── App.tsx                    # QueryClient, session and cart providers, the router
│   ├── routes.tsx                 # every route: layouts, lazy pages, error boundaries
│   ├── RootLayout.tsx             # header + <Outlet />, focus and scroll on navigation
│   └── …                          # SiteHeader, NotFoundPage, RouteErrorPage, NavigationProgress
├── components/ui/                 # Card, Section, StatusMessage, TextField
├── hooks/                         # useDocumentTitle, useOnVisible, useLateHeadingFocus
├── lib/
│   ├── api.ts                     # the one API client (packages/shared)
│   ├── query-client.ts            # the one QueryClient and its defaults
│   ├── api-form-errors.ts         # VALIDATION_FAILED details → form fields
│   └── error-message.ts           # ApiError → Indonesian text
└── features/
    ├── catalog/                   # "/": filters in the URL, infinite product list, categories
    ├── product/                   # "/produk/:slug" (lazy), prefetch on hover
    ├── cart/                      # guest cart token, add (optimistic), header count, "/keranjang"
    └── auth/                      # "/masuk", "/daftar" (lazy), the web session (cookie + in-memory access token)
```

Each feature keeps its own `components/`, `hooks/` and `api/` (query keys and options).

`@/…` is an alias for `src/…` (`tsconfig.app.json` `paths` and `vite.config.ts` `resolve.alias`).

Every route works as a deep link: Caddy answers `index.html` for any path that is not a file, and the router picks the page. The dev server does the same.

In development, the TanStack Query devtools button sits in the bottom-left corner; a production build leaves the devtools out of the bundle.
