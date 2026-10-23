# Checkout load test (k6)

`checkout.js` loads `POST /v1/checkout` on the Compose stack (Bab 5,
artikel 14; ADR 0006). `run.sh` runs it and then checks the database for
oversold stock with `verify.sql`.

## Run it

```bash
make up
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
- **It does not change the password of buyers that already exist.** Use the
  same `SEED_LOADTEST_PASSWORD` every time. If you have forgotten it,
  `docker-compose down -v` starts from an empty database.
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

## Results (2026-10-23, `bab-5`, MacBook arm64, colima, k6 2.3.0 in Docker)

Defaults: 12 plenty VUs for 30 s, and 8 scarce VUs × 3 attempts. Each run
started from a fresh `make seed-loadtest users=20`.

```
  █ THRESHOLDS
    http_req_duration{name:checkout,scenario:plenty}   ✓ 'p(95)<500' p(95)=51.4ms
    http_req_duration{name:checkout,scenario:scarce}   ✓ 'p(95)<500' p(95)=42.29ms
    plenty_orders                                      ✓ 'count>0' count=7678
    scarce_orders                                      ✓ 'count<=10' count=10
    unexpected_responses                               ✓ 'rate<0.01' rate=0.00%

    checks_succeeded...: 100.00% 23140 out of 23140
    plenty_orders......: 7678  255.6/s
    scarce_orders......: 10
    scarce_sold_out....: 14
    { name:checkout,scenario:plenty }: avg=22.55ms med=17.89ms p(90)=41.48ms p(95)=51.4ms max=645.75ms
    { name:checkout,scenario:scarce }: avg=24.68ms med=20.84ms p(90)=38.6ms  p(95)=42.29ms max=44.68ms
    http_reqs..........: 23140 770.4/s   (http_req_failed 0.06%: the 14 expected sold-out 409s)
    iterations.........: 7702  256.4/s

loadtest: checking the database for oversold stock
NOTICE:  LOADTEST-SCARCE: stock 0, 10 unpaid orders, 10 units
NOTICE:  LOADTEST-PLENTY: stock 1000000, 0 units in live orders
NOTICE:  oversell check passed
```

Four more runs gave the same outcome every time: 10 scarce orders, scarce
stock 0, no unexpected answer, and plenty checkout p95 between 48 and 76 ms.

One of those runs was made while the machine's 15-minute load average was
about 86, from other test suites on the same colima VM. In that run, a 7-s
cluster of slow requests appeared. It hit every kind of request at once,
including cart adds that take no contested lock, and pushed the checkout
max to 7.4 s. A rerun with `log_lock_waits = on` showed no lock wait over
`deadlock_timeout` (1 s). So read the max as a property of the machine, not
of the locks; the p95 is the number to compare.

All plenty buyers decrement and restore the same variant row, which is the
worst case ADR 0006 describes: buyers queue on that row's lock. At
12 concurrent buyers, that queue costs about 20 ms per checkout. That does
not yet justify the batched `INSERT … SELECT FROM unnest(…)` alternative.
