# apps/web — GoShop storefront

The storefront for buyers: a Next.js 16 (App Router) + React 19 + TypeScript app; Bab 7–10 built it as a Vite single-page app. Bab 7 set it up with one page, the category list. Bab 8 added the catalog and the product page in plain React. Bab 9 adds pages with React Router (`/`, `/produk/:slug`, `/keranjang`, `/masuk`, `/daftar`, a 404), server data with TanStack Query, a guest cart, and the login and registration forms with React Hook Form and Zod. Bab 10 restyles it with Tailwind CSS and shadcn/ui, keeps the guest cart in a Zustand store, and keeps the buyer logged in across reloads with an httpOnly refresh cookie. Bab 11 adds checkout, payment and order pages, then moves it to the Next.js App Router so the catalog and product pages render on the server. `docs/web/README.md` maps every chapter to the code.

## Run it

```bash
nvm use                                   # Node 24, from .nvmrc
pnpm install
make up                                   # or: make dev-api, with postgres and redis running
pnpm --filter @goshop/web dev             # http://localhost:5173
```

Open **http://localhost:5173**, not `127.0.0.1:5173`: the API's CORS default (`APP_CORS_ALLOWED_ORIGINS=http://localhost:5173`) allows that exact origin, so `dev` always runs `next dev --port 5173` (it stops if the port is taken).

`make up` also starts the built storefront (the `web` service) on the same port 5173, so stop it (`docker compose stop web`) before `pnpm dev`, or use the container instead of the dev server.

The Playwright suite in `e2e/` expects the example catalog from `make seed`: `make test-integration` seeds first, so run `make seed` yourself before running the suite against your own `make up` (without it, the page shows "Belum ada kategori.").

Before the suite runs, its global setup (`e2e/support/global-setup.ts`) writes to the Compose project it tests, never anywhere else: it clears the API's rate-limit counters (`goshop:rl:*` in Redis), registers the e2e buyer `e2e-buyer@goshop.local` through `POST /v1/auth/register`, and marks it verified with `psql` in the Compose Postgres.

| Script      | What it does                                                                         |
| ----------- | ------------------------------------------------------------------------------------ |
| `dev`       | `next dev` on port 5173, with hot reload                                             |
| `typecheck` | `next typegen` (route types), then `tsc` for the app and for `vite.config.ts`        |
| `format`    | `prettier --write` and `eslint --fix`                                                |
| `lint`      | ESLint (no warnings allowed) and `prettier --check`                                  |
| `build`     | `next build`: a standalone server in `.next/standalone`; needs `NEXT_PUBLIC_API_URL` |
| `start`     | `next start`: serves the production build (port 3000, or `--port`)                   |
| `test:unit` | Vitest, in a jsdom environment (`vite.config.ts` only configures Vitest now)         |

## The web session locally (Bab 10)

Logging in sets an httpOnly refresh cookie, `goshop_refresh`, that the browser sends back to `/v1/auth/web/*` by itself; a reload restores the session from it ([ADR 0008](../../docs/adr/0008-web-session-cookie.md)). Three things must line up, or the storefront silently behaves as if nobody were logged in:

1. **The storefront's origin is in the API's `APP_CORS_ALLOWED_ORIGINS`**, exactly (scheme, host, port; no trailing slash). The web endpoints refuse any other `Origin` with `403 FORBIDDEN` (`details.reason: origin`), and CORS allows credentials only for listed origins. The default, `http://localhost:5173`, matches `pnpm dev`. Running the dev server on another port, or a second stack, means adding that origin: for example `APP_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:34173`.
2. **The storefront and the API are the same site.** `SameSite=Strict` cookies travel only between hosts of one registrable domain. `localhost:5173` → `localhost:8080` is one site (ports do not count). Use `localhost` for both, never `localhost` for one and `127.0.0.1` for the other: those are two sites, and the cookie is never sent. In a deployment this means custom domains under one domain (`shop.example.com` and `api.example.com`); Railway's generated `*.up.railway.app` hosts are separate sites (`docs/configuration.md`).
3. **The browser keeps a `Secure` cookie.** The API sets `Secure` by default (`APP_AUTH_COOKIE_SECURE=true`). Chromium and Firefox treat `http://localhost` as a secure context and keep the cookie, so `make up`, `pnpm dev` and the e2e suite need nothing. Set `APP_AUTH_COOKIE_SECURE=false` (accepted only with `APP_ENV=development`) only for a browser that is not in a secure context, such as a phone opening `http://192.168.x.x:5173` over the LAN, or a browser that does not extend the localhost exception to cookies. Note that such a page also has no Web Locks API (`navigator.locks` exists only in a secure context), so two of its tabs can still race a refresh (see `features/auth/refresh-lock.ts`).

To check it: log in, then DevTools → Application → Cookies → `http://localhost:8080` shows `goshop_refresh` with `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/v1/auth/web`; Local Storage and Session Storage hold no token (only `goshop:cart` and `goshop:theme`). A reload keeps you logged in, and the Network panel shows one `POST /v1/auth/web/refresh` per page load (`204` when logged out).

## Configuration

| Variable              | Read                            | What it is                                                                                                                                                                    |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | at build time, by the browser   | the API as the **browser** reaches it. Written into the JavaScript: public, never a secret; `next build` stops without it; unset in development means `http://localhost:8080` |
| `API_INTERNAL_URL`    | at run time, by the server only | the API as the storefront's **server** reaches it (`http://api:8080` in Compose); unset means `NEXT_PUBLIC_API_URL`                                                           |
| `SITE_URL`            | at run time, by the server only | the storefront's public origin, for canonical links, Open Graph and structured data; unset means `http://localhost:5173` in development and a 500 in production               |
| `IMAGE_ORIGIN`        | at run time, by the server only | the origin product photos come from (the image storage), for the CSP's `img-src`; unset means `http://localhost:8333` in development and no photos in production              |

Next.js replaces only a literal `process.env.NEXT_PUBLIC_…` in code with its value, at build time, so changing the public URL means building again; the server-only variables are read when the server starts, so one image can run against any API it can reach. `lib/server-config.ts` imports `server-only`: a client component that imported it would fail the build.

| Where                      | How it is set                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                 | `apps/web/.env.local` (copy `.env.example`)                                                              |
| `pnpm build`, `make build` | the environment, for example `NEXT_PUBLIC_API_URL=http://localhost:8080 pnpm --filter @goshop/web build` |

## Container

_Until Bab 11 artikel 14 this section describes the Vite image (Caddy); artikel 14 replaces it with the Next.js standalone server._

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
├── app/                           # the routes (Next.js App Router): one folder per URL segment
│   ├── layout.tsx                 # <html>, <head> (theme.js), Providers + SiteFrame around every page
│   ├── page.tsx                   # "/": the catalog (server-rendered)
│   ├── produk/[slug]/             # "/produk/[slug]" (server-rendered) and its 404
│   ├── keranjang/                 # "/keranjang" (browser only)
│   ├── (auth)/                    # "/masuk", "/daftar" (browser only, noindex)
│   ├── (akun)/                    # pages behind RequireAuth (browser only, noindex)
│   ├── not-found.tsx, error.tsx   # the 404 (status 404) and the error boundary
│   └── healthz/route.ts           # liveness probe
├── proxy.ts                       # the CSP with a per-request nonce
├── config.ts                      # NEXT_PUBLIC_API_URL, checked once
├── components/
│   ├── layout/                    # Providers, SiteFrame, SiteHeader, client-pages, ErrorPage, NotFoundPage
│   ├── navigation/                # NavLink (aria-current), Redirect
│   └── ui/                        # shadcn/ui and our small components
├── hooks/                         # useOnVisible, useLateHeadingFocus
├── lib/
│   ├── api.ts                     # the browser's API client (packages/shared)
│   ├── server-config.ts           # server-only settings (API_INTERNAL_URL, SITE_URL, IMAGE_ORIGIN)
│   ├── query-client.ts            # getQueryClient: one per request on the server, one per visit in the browser
│   ├── navigation-state.ts        # what one page hands the next (React Router's location.state)
│   ├── api-form-errors.ts         # VALIDATION_FAILED details → form fields
│   └── error-message.ts           # ApiError → Indonesian text
└── features/                      # catalog, product, cart, auth, account, checkout, orders, theme
```

Each feature keeps its own `components/`, `hooks/` and `api/` (query keys and options).

`@/…` is an alias for `src/…` (`tsconfig.json` `paths`; `vite.config.ts` repeats it for Vitest).

In development, the TanStack Query devtools button sits in the bottom-left corner; a production build leaves the devtools out of the bundle.
