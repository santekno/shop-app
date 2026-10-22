# santekno/sdk gaps

The API uses [santekno/sdk](https://github.com/santekno/sdk) for every concern it covers. This file lists what the sdk does not cover (yet), and what GoShop does instead. Each gap is a candidate for an upstream sdk contribution.

GoShop pins **sdk v0.2.0, released 2026-10-22 (tag v0.2.0, commit 97a873a)**, from [PR #33](https://github.com/santekno/sdk/pull/33): the first version with `middleware/chi`, `uuidx.NewV7`, and the `healthx` JSON `Content-Type` fix plus `Handler.HideErrors`. Always pin `@v0.2.0` explicitly, never `@latest`.

| Concern | Gap in sdk | What GoShop does | Since |
|---|---|---|---|
| chi middleware, UUIDv7, health probe JSON | Missing in v0.1.8. | Resolved in v0.2.0; pin `github.com/santekno/sdk v0.2.0`, no adapter needed. | Bab 2 |
| Config parsing | `configx` typed getters (`Int`, `Duration`) return 0 for a malformed value instead of an error, and `WithEnv` reads only the process environment under one prefix, so Railway's unprefixed `PORT` is outside it. | `internal/config` reads values as strings, parses and range-checks them itself, reads `PORT` with `os.LookupEnv`, and joins every problem into one startup error. | Bab 2 |
| S3 storage | `storagex` has only `MemStorage` and `LocalStorage`: no S3 and no presigned URLs. | GoShop's own S3 adapter implementing `storagex.Storage`, with presigned upload URLs, works against SeaweedFS locally and any S3-compatible bucket in production. | Bab 6 |
| Rate limiting | `ratelimitx` is a nested module with its own `go.mod` (`github.com/santekno/sdk/ratelimitx`) and no `ratelimitx/vX.Y.Z` tag, so the root tag does not include it. | Pin it by pseudo-version (`v0.0.0-<date>-<commit>` from a commit on sdk `main`), never by `replace`, and switch to a tag once one exists. | Bab 4 |
| Test databases | `testx.PostgresContainer` and `testx.RedisContainer` start nothing: they read `POSTGRES_DSN` / `REDIS_ADDR` and call `t.Skip` when unset (`RedisContainer` also skips when it cannot connect). | `make test-integration` starts the Compose dependencies, exports `POSTGRES_DSN`, `REDIS_ADDR` and `S3_ENDPOINT`, and fails if any test was skipped (`scripts/no-skips.sh`). | Bab 2 |
| Tracing, metrics | `tracex` is an interface with a no-op tracer only; `metricx` is an interface with an in-memory registry only. Neither exports anywhere. | OpenTelemetry and Prometheus adapters implementing the sdk interfaces. | Bab 19 |
