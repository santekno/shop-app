# apps

Every deployable application lives here. The folders appear chapter by chapter, so on an early `bab-N` branch some of them do not exist yet.

| App | Path | What it is | Arrives in |
|---|---|---|---|
| API | `apps/api` | Go REST API (`cmd/api`) | Bab 2 |
| Worker | `apps/api` | Background job binary (`cmd/worker`) in the same Go module as the API | Bab 6 |
| Web | `apps/web` | Storefront for buyers (React) | Bab 7 |
| Admin | `apps/admin` | Dashboard for sellers and admins (React) | Bab 12 |
| Mobile | `apps/mobile` | Android and iOS app (React Native + Expo) | Bab 13 |

Code shared between the TypeScript apps (API types, utilities) goes in `packages/`, not here.
