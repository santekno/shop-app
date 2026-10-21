# 0003. Use SeaweedFS as local S3 storage

- Status: Accepted
- Date: 2026-10-21
- Chapter: Bab 1

## Context

GoShop stores product and review images in object storage. In production that can be any S3-compatible bucket (AWS S3, Cloudflare R2, a Railway bucket, …). Locally, and in the integration tests of the verified gate, we need an S3 server that runs in Docker Compose with no account and no internet access.

MinIO used to be the default choice, but MinIO stopped publishing its community Docker images and binaries, so a `docker compose up` that depends on them is no longer something a course can rely on.

## Decision

We will run [SeaweedFS](https://github.com/seaweedfs/seaweedfs) with its S3 gateway as the `storage` service in `docker-compose.yml`, pinned to an explicit image tag, listening on port `8333`.

- Local credentials live in `deploy/seaweedfs/s3.json` and match the placeholders in `.env.example`. They are local-only, not secrets.
- The API talks to storage only through the plain S3 API (endpoint, bucket, access key, secret key from environment variables). It uses nothing specific to SeaweedFS.
- Production points the same variables at whichever S3-compatible bucket the deployment uses.

## Alternatives considered

- **MinIO** — no longer publishes the community images we would pin.
- **LocalStack** — emulates much more than S3 and is heavier than we need.
- **Local filesystem in development, S3 in production** — two code paths, and presigned upload URLs (Bab 6) could not be tested locally.

## Consequences

- Development, tests and production exercise the same S3 code path; switching providers is a configuration change.
- We may only use S3 features that both SeaweedFS and the production provider support (basic object operations and presigned URLs).
- The SeaweedFS image tag is pinned and must be bumped deliberately.
- The bucket is created by the application or a setup step, not by the storage container.
