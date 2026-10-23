# GoShop

GoShop is the online store built step by step in the **Santekno Fullstack Course** ([santekno.com/series/fullstack-goshop](https://www.santekno.com/series/fullstack-goshop/)): a Go backend, a React storefront and admin dashboard, and a React Native app for Android and iOS.

| App | Path | Stack |
|---|---|---|
| GoShop API + worker | `apps/api` | Go 1.26, chi, [santekno/sdk](https://github.com/santekno/sdk), PostgreSQL, sqlc, Redis |
| GoShop Web (storefront) | `apps/web` | React + TypeScript (Vite, later Next.js) |
| GoShop Admin | `apps/admin` | React + Vite, TanStack Query, shadcn/ui |
| GoShop Mobile | `apps/mobile` | React Native + Expo, Expo Router |

## One branch per chapter

Every chapter of the course is a branch: `bab-1` … `bab-20`. Each branch contains everything from the previous one plus that chapter's code, so

```bash
git diff bab-4..bab-5                       # everything chapter 5 added
git log --oneline --grep "bab-5/artikel-03"  # the commits behind one article
```

`main` always points at the latest finished chapter. `docs/bab-N.md` lists which article maps to which files, and the commit that passed the chapter's checks (written once the chapter's checks pass, after its last article).

## Run it

Requirements: Docker (with Compose), Go 1.26+, Node.js 24 LTS (22.12+ works), pnpm.

```bash
cp .env.example .env
make up        # Postgres (pgvector), Redis, SeaweedFS (S3) + every service the branch has
make verify    # build, lint, docker images, unit + integration tests, secret scan
```

On the `bab-1` branch these files arrive article by article: `.env.example` in artikel-13 and the `Makefile` (`make up`, `make verify`) in artikel-12.

## Security

[`apps/api/SECURITY.md`](apps/api/SECURITY.md) maps the OWASP API Security Top 10 (2023) to what the API does, with its known limits; [ADR 0005](docs/adr/0005-auth-tokens.md) is the token design.

## Deploy

Every service has its own Dockerfile (built with the repository root as context) and a Railway config in `deploy/railway/`, so the monorepo deploys as separate services. The mobile app is built with EAS for Android and iOS.

## License

MIT
