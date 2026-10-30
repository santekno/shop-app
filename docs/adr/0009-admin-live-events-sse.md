# 0009. Push order events to the admin dashboard with Server-Sent Events fed by Redis pub/sub

- Status: Accepted
- Date: 2026-10-30
- Chapter: Bab 12

## Context

The admin dashboard (`apps/admin`, Bab 12) should show a new paid order the moment it arrives, without the seller reloading the queue. The events already exist: every order status change writes an `order.*` event to the transactional outbox in its own transaction ([ADR 0006](0006-cart-checkout-orders.md)), and the worker's dispatcher publishes them every 5 seconds to the Asynq queue ([ADR 0007](0007-payments-uploads-worker.md)).

Forces:

- The feed is one-way: the server talks, the dashboard listens. The dashboard's actions stay ordinary REST calls.
- The API runs as several instances behind a load balancer, and the dispatcher runs in the worker, a different process. A browser's connection lands on any API instance; the event is published by the worker.
- Staff authenticate with a Bearer access token that lives 15 minutes ([ADR 0005](0005-auth-tokens.md)). Browsers' `EventSource` cannot send an `Authorization` header.
- Every API request runs under `APP_REQUEST_TIMEOUT` and the server's read and write timeouts (Bab 2). A stream lives for minutes.
- santekno/sdk v0.2.0 has no pub/sub or SSE helper (`docs/sdk-gaps.md`); go-redis and `net/http` cover both.

## Decision

We will serve **`GET /v1/admin/events` as a `text/event-stream`** (Server-Sent Events) and feed it from **one Redis pub/sub channel, `goshop:admin:events`**, which the outbox dispatcher publishes to after the worker's tasks.

### Publishing

`app.EventPublisher` is the outbox's publisher in the worker and in `api publish-events`: `outbox.Publishers{QueuePublisher, adminevents.Publisher}`, in that order. The second turns each `order` event into a feed message and `PUBLISH`es it. The message copies an allowlist of fields (type, order ID and code, status, total, time), so no buyer data reaches the dashboard. If the publish fails the dispatcher stops and retries the event on its next run, as for any publisher; the queue's task IDs keep the emails from going twice. An event whose payload does not decode is logged and skipped rather than returned, so a dashboard notification can never hold back the outbox.

### Serving

Each stream subscribes to the channel on its own Redis connection (go-redis `PubSub`), waits for Redis to confirm, and only then answers `200`, so nothing published after the stream opened is missed. It writes:

- `: connected` at once, `: ping` every 25 seconds while idle (proxies close quiet connections);
- one `id: <outbox event id>` / `event: order` / `data: <one line of JSON>` frame per message;
- `event: end` with `{"reason":"token_expired"}` when the caller's access token expires, or `{"reason":"shutdown"}` when the server begins shutting down, and then closes.

The route is registered through `httpserver.Options.Streams`, outside the request-timeout middleware, behind the same `Authenticate` and seller-or-admin `RequireRole` as every `/v1/admin` route. The handler lifts the server's read deadline for its own response (`http.ResponseController`; a passed read deadline cancels the request's context) and moves the write deadline ahead before every write, to one heartbeat plus 10 seconds, so a client that stops reading loses its stream. `App.Serve` registers `Handler.Shutdown` with `http.Server.RegisterOnShutdown`, so a graceful shutdown ends the streams at once instead of waiting for them until `APP_SHUTDOWN_TIMEOUT`.

### Delivery contract

- **At least once.** The dispatcher can publish an event twice; the client drops an `id` it has seen.
- **Live only, no replay.** Pub/sub keeps nothing. `Last-Event-ID` is ignored. After every (re)connect the client refetches what it shows. When go-redis reconnects a subscription on its own, whatever was published in between is lost, so the stream ends there and the client reconnects and refetches.
- **The token bounds the stream.** A stream ends when its access token expires; the client refreshes and reconnects, and the role and session are checked again. A session revoked mid-stream (logout) keeps its stream until then, at most 15 minutes, and it carries no personal data.
- **Latency** is the dispatcher's interval: up to about 5 seconds.

### Limits

At most 5 streams per account on one API instance (429 `TOO_MANY_STREAMS`): enough for a few tabs, and a client that leaks a stream on every reconnect hits the limit instead of opening a Redis connection per leak. The count lives in the instance's memory: a stream holds a connection to one instance, so that is where it costs, and a Redis counter would outlive a crashed instance.

## Alternatives considered

- **WebSockets.** Two-way, which the dashboard does not need, and a second protocol to proxy, authenticate and test. SSE is plain HTTP through the same router, middleware, CORS and logs.
- **Polling `GET /v1/admin/orders` every few seconds.** No new moving parts, but every open dashboard queries PostgreSQL every few seconds whether or not anything happened, and a new order still appears late.
- **`EventSource` with the token in the query string.** Works without a fetch-based reader, but the token ends up in access logs and proxy logs; the dashboard reads the stream with `fetch` and the token stays in the header.
- **An Asynq task per event that the API consumes.** The API would need its own task server, and a task goes to one consumer, not to every instance with an open stream; pub/sub fans out to all of them.
- **One shared subscription per API instance with an in-process hub.** Fewer Redis connections, but more code (a hub, per-client buffers, slow-client handling) for a dashboard that a handful of staff open; the per-stream subscription plus the per-account limit is enough until that changes.
- **Redis Streams with replay from `Last-Event-ID`.** Durable and resumable, but needs trimming, consumer bookkeeping and a replay path. The dashboard refetches on reconnect anyway, so replay buys little here.

## Consequences

- The dashboard sees order changes within seconds, from any API instance, with no polling.
- Every open stream holds a goroutine, a Redis connection and an HTTP connection. Redis' `maxclients` and the platform's connection limits must allow for the staff's open tabs.
- Streams survive the request timeout by design; a bug that leaks streams is caught only by the per-account limit and the token expiry, so the handler's exits (client gone, token expired, shutdown, lost subscription) are what the tests must cover.
- Proxies in front of the API must not buffer `text/event-stream` (the response sets `X-Accel-Buffering: no`) and must allow idle connections longer than the 25-second heartbeat.
- Events are not guaranteed to reach the dashboard: a client offline at the moment of publishing misses them and relies on its refetch. Anything that must not be missed (emails, the seller's Telegram message) stays on the queue.
