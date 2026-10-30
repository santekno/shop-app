# GoShop admin dashboard

`apps/admin` is where sellers and admins manage GoShop: products, stock, photos, orders and the sales report. It is a Vite + React single-page app, served by Caddy, with the same look, API client and login as the storefront. It arrives in Bab 12; this file has one section per article, like `docs/web/README.md` does for the storefront.

## Running it

```bash
make up                                   # API, database, storage and both web apps
# or, with hot reload, against an API from make up or make dev-api:
pnpm dev:admin                            # http://localhost:5174
```

Log in with a seller or admin account. Locally, `SEED_ADMIN_PASSWORD=… make seed-admin email=admin@goshop.local` creates an admin. A buyer account can log in too, and sees the "no access" page.

| Setting         | Kind     | Where                                                              | Meaning                                                                                                                                                                       |
| --------------- | -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`  | build    | `apps/admin/.env.local`, the Docker build argument, compose `args` | The API as the browser reaches it. Baked into the bundle, so it is public. Unset in development means `http://localhost:8080`; a production build refuses to start without it |
| `PORT`          | run time | container                                                          | Caddy's port (Railway sets it; 8080 otherwise)                                                                                                                                |
| `IMAGE_ORIGIN`  | run time | container                                                          | Origin(s) product photos are shown from (CSP `img-src`)                                                                                                                       |
| `UPLOAD_ORIGIN` | run time | container                                                          | Origin(s) the browser uploads photos to (CSP `connect-src`, artikel 04)                                                                                                       |

The API must allow the dashboard's origin in `APP_CORS_ALLOWED_ORIGINS` (its default includes `http://localhost:5174`). A Railway deployment needs the dashboard on the same registrable domain as the API (custom domains), for the same reason as the storefront: the session cookie is `SameSite=Strict` (`docs/configuration.md`).

# Bab 12: the admin dashboard

## Layout dashboard: sidebar, header, breadcrumb (artikel 01)

### The mental model

| Idea                                   | What it means                                                                                                                                                                                                 | Go comparison                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **A second app, not a second section** | The dashboard is its own deployable (`apps/admin`, its own image, its own origin), not `/admin` inside the storefront. Its code, bundle and CSP never reach a buyer, and a storefront deploy never touches it | A second `cmd/` binary in the same module: shared packages, separate process |
| **Layout routes**                      | A route without a path wraps its children in a frame (`DashboardLayout`) or a decision (`RequireStaff`); a page only renders its own content into the `<Outlet />`                                            | Middleware wrapping a group of handlers (`r.Group`)                          |
| **The route table as the one source**  | Each route names itself in `handle.crumb`; the breadcrumb reads them with `useMatches()`                                                                                                                      | Route metadata read by middleware, instead of a second list                  |
| **The UI hides, the API refuses**      | A buyer sees "no access" instead of the dashboard, but that is courtesy: every `/v1/admin` request is checked by the API (`403` for a buyer)                                                                  | Authorisation in the handler, never trusted from the client                  |

### Decisions

- **A Vite SPA, not Next.js.** Bab 11 moved the storefront to Next.js for SEO and the first paint of public pages. The dashboard is behind a login, has nothing for a crawler (`<meta name="robots" content="noindex">` and Caddy's `X-Robots-Tag: noindex`), and is used for hours in one tab, where a client-side app is at its best. So it is exactly the Bab 7–10 storefront's shape: Vite, React Router's data router, TanStack Query, Tailwind v4 with shadcn/ui, served by Caddy.
- **Port 5174.** The storefront owns 5173. `vite.config.ts` sets `strictPort`, so the dev server stops instead of drifting to a port the API's CORS list does not allow. `make up` publishes the container on the same `127.0.0.1:5174`: run one of the two at a time.
- **The same web session as the storefront** (Bab 10 artikel 12–14, ADR 0008): `POST /v1/auth/web/login` puts the refresh token in the `HttpOnly` `goshop_refresh` cookie, the access token stays in memory, a reload restores the session with `POST /v1/auth/web/refresh`, every cookie call runs under a Web Lock, and `createAuthClient` refreshes before expiry and once after a `401`. No new endpoint was needed.
- **Copied, not shared, for now.** `session-manager.ts`, `auth-client.ts`, `refresh-lock.ts`, `return-to.ts`, `error-message.ts` and `api-form-errors.ts` are copies of the storefront's (the session manager without its guest-cart hook). They would fit `packages/shared`, but moving them means moving their tests too, and `packages/shared` requires 70% coverage per file; that move is a follow-up for both apps at once. What already is shared is used from `@goshop/shared`: the API client with its retries, `webLogin`/`webRefresh`/`webLogout`, `loginSchema`, `ApiError`, and the generated `User` type with its `role`.
- **One cookie for two apps.** The cookie belongs to the API's host, not to the app that logged in, so on one browser the storefront and the dashboard share one session: logging in to the dashboard as a seller replaces a buyer's storefront session, and logging out of either logs out of both. The "no access" page says so before its "Keluar" button. The Web Lock that keeps two tabs from refreshing the same cookie at once is per origin, so a storefront tab and a dashboard tab can still collide (the API's reuse detection then ends the session, and the user logs in again). Rare in practice (staff rarely shop on the same browser profile); a cookie per client would end it (an open question for the API).
- **The role gate** (`features/auth/components/RequireStaff.tsx`): one layout route around the whole dashboard decides what renders. While the start-up refresh runs: "Memeriksa sesi Anda…". Nobody logged in: `/masuk?kembali=<the page asked for>`, checked by `safeReturnPath` (no open redirect). A buyer: the "no access" page at whatever URL was asked for, never the dashboard's frame. A seller or an admin: the dashboard. The role comes from the session (`session.user.role`, refreshed with every token), through `isStaffRole` in `features/auth/roles.ts`. What each staff role may do (a seller may not cancel an order) is artikel 08.
- **The layout** (`app/DashboardLayout.tsx`), in reading order: skip link, header (`<header>`: the phone menu button, "GoShop Admin", the user menu), sidebar (`<nav aria-label="Menu utama">`: Ringkasan, Produk, Pesanan, Laporan), `<main>` with the breadcrumb and the page. From `md` the sidebar sits beside `<main>`; below it, it folds under the header behind a "Menu" button (`aria-expanded`, `aria-controls`). A disclosure rather than a modal drawer: Radix's Dialog locks scrolling by inserting a `<style>` element, which the CSP (`style-src 'self'`) refuses, the same reason the storefront's menu is non-modal. Following a link folds it again.
- **The sidebar is data** (`app/navigation.ts`): path, label, icon and a one-line description per section. The sidebar renders it, the overview page renders the same items as cards, and artikel 08 adds the role that may see each one. React Router's `<NavLink>` sets `aria-current="page"`; the active style is written against that attribute (`aria-[current=page]:bg-primary`), so the eye and a screen reader get the same fact. "Ringkasan" uses `end`, or it would be active on every path.
- **Breadcrumbs from the route table** (`app/route-crumbs.ts`, `app/Breadcrumbs.tsx`, shadcn/ui's `Breadcrumb` in `components/ui`). Each route says `handle: { crumb: "Produk" }`; `breadcrumbsFrom(useMatches())` turns the matched routes into steps, outermost first: "Dasbor › Produk". A new page gets its breadcrumb by being added to `routes.tsx`, with no second list to forget. The last step is a `<span aria-current="page">`, not a link to the page already on screen; the separators are `aria-hidden`.
- **Focus after a navigation** (`app/useRouteFocus.ts`): the new page's `<h1>` (every page has one, `tabIndex={-1}`, through `PageHeader`) gets the focus, so a screen reader reads the page's name and Tab continues from there. Unlike the storefront, the hook runs in the root route (`app/AppRoot.tsx`) and finds `<main id="konten">` by id: the dashboard has three frames (the login page, the "no access" page, the dashboard), and a login moves from one to another. Inside one layout, the hook would mount fresh with the new path and see no navigation at all. The login page, the "no access" page and the start-up check share `app/CenteredPage.tsx`, whose `<main>` has the same id.
- **Accessibility**, beyond the above: the skip link ("Langsung ke konten utama") is the first Tab stop; the focus ring is an outline from the design tokens (`:focus-visible`, kept in Windows' forced-colours mode); icons are `aria-hidden` next to visible text; the phone menu button's name stays "Menu" in both states (`aria-expanded` carries the state); the user menu is Radix's (a real button, arrow keys, Escape, the focus back on the trigger); a failed logout is a `role="alert"`, and the user stays logged in rather than looking logged out.
- **Design tokens: the storefront's.** `src/index.css` is the storefront's colour roles, radius, type and spacing, so the two apps look like one product. Dark mode follows the device (Tailwind's own `dark` variant) without the storefront's toggle and its pre-paint script.
- **Code splitting:** only the login page is lazy (`features/auth/lazy.ts`): React Hook Form and Zod are about a fifth of the JavaScript, and a seller who reloads with a live session never needs them. The main bundle is about 155 kB gzipped.
- **Query defaults** (`lib/query-client.ts`): the storefront's (`retry: false`, because the API client already retries what is worth retrying), with a shorter `staleTime`, 10 seconds: orders and stock change under a seller's hands. After a logout, every cached query is removed, so the next person at the browser never sees the last one's orders.

### The container and the CSP

`apps/admin/Dockerfile` and `apps/admin/Caddyfile` are the Bab 7–10 storefront's (`git show bab-10:apps/web/Dockerfile`): pnpm builds the bundle with the repository root as context, Caddy serves it on `$PORT` as a non-root user, `/healthz` answers without touching files, hashed `/assets/*` are cached for a year and a missing one is a plain `404`, every other path falls back to `index.html` with `no-cache`.

The Content-Security-Policy:

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data: {$IMAGE_ORIGIN};
connect-src 'self' <API origin> {$UPLOAD_ORIGIN};
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Two kinds of origin, two mechanisms:

- **The API's origin is fixed at build time**, because the bundle is: `VITE_API_URL` is a build argument that Vite bakes in, and the Dockerfile writes its origin to `/etc/caddy/api-origin`, which the Caddyfile reads with `{file.…}`. The CSP and the bundle cannot name two different APIs.
- **The storage's origins are read at run time**: `{$IMAGE_ORIGIN}` and `{$UPLOAD_ORIGIN}` are Caddy environment placeholders, replaced when Caddy reads its config at start-up. One image therefore works against any storage, local SeaweedFS or a bucket, by setting two variables, with no rebuild; the bundle never needs them, because the API hands out every photo URL and every presigned upload URL. Unset means empty: photos and uploads are blocked, everything else works. Each value is one or more origins separated by spaces (an operator's setting, never user input). `make up` sets both to the storage as the host sees it (`S3_PRESIGN_ENDPOINT`, default `http://localhost:8333`).

`X-Robots-Tag: noindex, nofollow` joins the storefront's headers. Compose publishes the container on `127.0.0.1:5174`; Railway builds it from `deploy/railway/admin.json` and checks `/healthz`.

### Where each idea lives

Paths are relative to `apps/admin/src`.

| Concept                                                        | Where to read it                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The route table, layout routes, `handle.crumb`, the lazy login | `app/routes.tsx`                                                                                                                                      |
| Providers: the query cache, the session, the router            | `app/App.tsx`, `main.tsx`                                                                                                                             |
| The role gate                                                  | `features/auth/components/RequireStaff.tsx`, `features/auth/roles.ts`, `features/auth/components/NoAccessPage.tsx`                                    |
| The web session                                                | `features/auth/SessionProvider.tsx`, `session-context.ts` (`useSession`, `useSessionUser`), `session-manager.ts`, `auth-client.ts`, `refresh-lock.ts` |
| Login and logout                                               | `features/auth/components/LoginPage.tsx`, `hooks/useLogin.ts`, `hooks/useLogout.ts`, `components/UserMenu.tsx`                                        |
| The frame                                                      | `app/DashboardLayout.tsx`, `app/AppHeader.tsx`, `app/Sidebar.tsx`, `app/navigation.ts`, `app/SkipLink.tsx`, `app/CenteredPage.tsx`                    |
| Breadcrumbs                                                    | `app/route-crumbs.ts`, `app/Breadcrumbs.tsx`, `components/ui/Breadcrumb.tsx`                                                                          |
| Focus after navigation                                         | `app/useRouteFocus.ts`, `app/AppRoot.tsx`, `components/PageHeader.tsx`                                                                                |
| The pages                                                      | `features/dashboard/components/OverviewPage.tsx`; `features/{products,orders,reports}/components/*Page.tsx` (filled in by artikel 02, 06 and 07)      |
| shadcn/ui                                                      | `components/ui/` (only what is used), `components.json`, `lib/utils.ts`                                                                               |
| Container and deploy                                           | `../Dockerfile`, `../Caddyfile`, `../../../deploy/railway/admin.json`, the `admin` service in `docker-compose.yml`                                    |
