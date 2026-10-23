# Checkout load test (k6)

`checkout.js` loads `POST /v1/checkout` on the Compose stack (Bab 5,
artikel 14; ADR 0006). `run.sh` runs it and then checks the database for
oversold stock with `verify.sql`.

## Run it

```bash
APP_CHECKOUT_LIMIT_PER_MINUTE=100000 make up
make seed
SEED_LOADTEST_PASSWORD='a-password-the-policy-accepts' make seed-loadtest users=20
SEED_LOADTEST_PASSWORD='a-password-the-policy-accepts' make loadtest
```

- `make loadtest` uses a local `k6` when there is one. Otherwise it uses the
  `grafana/k6:2.3.0` image. That container joins the api container's network
  namespace, so `http://localhost:8080` is the API. The script goes in on
  stdin, so nothing is mounted.
- `make seed-loadtest` creates buyers `loadtest-0001@goshop.local` and up,
  each verified and with a default address. It also creates the product
  `loadtest-kaos`, with `LOADTEST-PLENTY` (1,000,000 units) and
  `LOADTEST-SCARCE` (10 units). Run it again before every load test: it
  resets both stocks and closes the load-test buyers' unpaid orders.
- A rerun with another `SEED_LOADTEST_PASSWORD` sets that password on every
  `loadtest-*` buyer that already exists, so the password `make loadtest`
  gets is always the one the last `make seed-loadtest` used.
- **The api must run with `APP_CHECKOUT_LIMIT_PER_MINUTE=100000`.** Preview,
  shipping quotes and checkout are limited per buyer, 30 per minute each by
  default, and one VU checks out about 1,200 times a minute. With the default,
  almost every checkout would be a 429 and the test would measure the rate
  limiter. `run.sh` reads the running api container's environment and stops
  with a message before k6 starts when the limit is lower. Restart with
  `APP_CHECKOUT_LIMIT_PER_MINUTE=100000 make up`, and use a plain `make up`
  again afterwards.
- Login is limited to 20 attempts per IP per 15 minutes, and every k6 VU
  logs in once. So `PLENTY_VUS + SCARCE_VUS` is at most 20, and `run.sh`
  clears `goshop:rl:*` in the Compose Redis first, so you can run twice in a
  row. If a login fails, the script aborts the whole test instead of
  retrying it into the rate limit.

You can set these in the environment:

| Variable | Default | Meaning |
|---|---|---|
| `PLENTY_VUS` | 12 | buyers that loop add → checkout → cancel |
| `DURATION` | 30s | how long they loop |
| `SCARCE_VUS` | 8 | buyers that compete for the 10 scarce units |
| `SCARCE_ATTEMPTS` | 3 | attempts per scarce buyer (24 attempts for 10 units) |

## What each VU does

1. `POST /v1/auth/login` as its own buyer (once).
2. `GET /v1/me/addresses`, and keeps the default address (once).
3. `GET /v1/products/loadtest-kaos`, and keeps the variant ids (once).
4. `POST /v1/cart/items` with one unit.
5. `POST /v1/checkout` with `{address_id, courier: "jne", service: "REG"}`
   and a fresh `Idempotency-Key` per attempt. The same key is reused on
   retries: after a lost answer, a 5xx, or 409 `IDEMPOTENCY_IN_PROGRESS`.
6. What happens next depends on the scenario:
   - **plenty**: `POST /v1/orders/{id}/cancel`, so a buyer never reaches
     the cap of 5 unpaid orders.
   - **scarce**: keeps the order. On 409 (`INSUFFICIENT_STOCK` at the add,
     or `CHECKOUT_PROBLEMS` at checkout) it removes the line and tries again.

The scarce scenario starts 5 s into the plenty one, so the scarce checkouts
run under load.

## Pass criteria

k6 thresholds:

- p95 of `checkout` < 500 ms in each scenario (locally, on `make up`).
- `unexpected_responses` < 1%. This counts every answer the flow does not
  allow: a 5xx, a 401, an unexpected 4xx.
- `scarce_orders` ≤ 10, and `plenty_orders` > 0.

`verify.sql` then checks the database:

- `LOADTEST-SCARCE` stock is exactly 0, with exactly 10 unpaid orders of one
  unit each.
- `LOADTEST-PLENTY` stock plus the units in live load-test orders is still
  1,000,000, so every cancel gave its unit back exactly once.
- No variant anywhere has stock below 0.

`make loadtest` fails if either the thresholds or the SQL check fail.

## Results (2026-10-24, `bab-5`, MacBook arm64, colima, k6 2.3.0 in Docker)

Defaults: 12 plenty VUs for 30 s, and 8 scarce VUs × 3 attempts, against
`APP_CHECKOUT_LIMIT_PER_MINUTE=100000 make up`. Each run started from a fresh
`make seed-loadtest users=20`, the second with a new password.

```
  █ THRESHOLDS
    http_req_duration{name:checkout,scenario:plenty}   ✓ 'p(95)<500' p(95)=57.81ms
    http_req_duration{name:checkout,scenario:scarce}   ✓ 'p(95)<500' p(95)=21.36ms
    plenty_orders                                      ✓ 'count>0' count=7844
    scarce_orders                                      ✓ 'count<=10' count=10
    unexpected_responses                               ✓ 'rate<0.01' rate=0.00%

    checks_succeeded...: 100.00% 23636 out of 23636
    plenty_orders......: 7844  261.2/s
    scarce_orders......: 10
    scarce_sold_out....: 14
    { name:checkout,scenario:plenty }: avg=22.75ms med=16.21ms p(90)=44.54ms p(95)=57.81ms max=368.64ms
    { name:checkout,scenario:scarce }: avg=13.7ms  med=13.91ms p(90)=19.79ms p(95)=21.36ms max=22.35ms
    http_reqs..........: 23636 787.1/s   (http_req_failed 0.05%: the 14 expected sold-out 409s)
    iterations.........: 7868  262.0/s

loadtest: checking the database for oversold stock
NOTICE:  LOADTEST-SCARCE: stock 0, 10 unpaid orders, 10 units
NOTICE:  LOADTEST-PLENTY: stock 1000000, 0 units in live orders
NOTICE:  oversell check passed
```

The second run, with a different `SEED_LOADTEST_PASSWORD`, gave the same
outcome: 7,987 plenty orders at 801 req/s, plenty checkout p95 56.37 ms,
scarce p95 30.48 ms, 0 unexpected answers, and exactly 10 scarce orders with
stock 0. Earlier runs on 2026-10-23, before the per-buyer limits existed,
had plenty checkout p95 between 48 and 76 ms.

One of those earlier runs was made while the machine's 15-minute load
average was about 86, from other test suites on the same colima VM. In that
run, a 7-s cluster of slow requests appeared. It hit every kind of request
at once, including cart adds that take no contested lock, and pushed the
checkout max to 7.4 s. A rerun with `log_lock_waits = on` showed no lock
wait over `deadlock_timeout` (1 s). So read the max as a property of the
machine, not of the locks; the p95 is the number to compare.

All plenty buyers decrement and restore the same variant row, which is the
worst case ADR 0006 describes: buyers queue on that row's lock. At
12 concurrent buyers, that queue costs about 20 ms per checkout. That does
not yet justify the batched `INSERT … SELECT FROM unnest(…)` alternative.
