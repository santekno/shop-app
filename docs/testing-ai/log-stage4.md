# AI test log — Bab 12 stage 4 fix round (test-engineer)

Same method as slices A and B: after the first full draft of each
change, break one guarded line of production code at a time
(`docs/testing-ai/mutate.py` for TypeScript, decided by the test run's
exit code; a Go copy, `<scratch>/s4te/gomut.py`, runs `go test` the same
way), restore it with `git checkout`, and check the production diff is
empty. It was empty after every run. Base: `bab-12` @ 3f98683f (the
stage-4 fixes d71555d1 … a3afae89). Specs: `<scratch>/s4te/*.json`.

"Killed by draft" counts a mutant killed by the tests as first written,
before any mutant had been run against them. "Not observable" means no
test can tell the mutant from the code (with the reason).

| Change (artikel)                                                             | Mutants tried | Killed by draft | Killed after fix | Not observable |
| ---------------------------------------------------------------------------- | ------------- | --------------- | ---------------- | -------------- |
| MSW unhandled-request guard (11)                                             | 4             | 2               | 3                | 1              |
| order actions "uncertain": classification, cause, hook, panel (06)           | 14            | 14              | 14               | 0              |
| image-cache cancel, storage refusal from "start" (04)                        | 4             | 3               | 3                | 1              |
| conflict-review focus, cause texts, over-max stock, quick stock (05)         | 12            | 9               | 10               | 2              |
| ReportsPage stale-report line (07)                                           | 5             | 5               | 5                | 0              |
| ProductsPage stale-rows line (02)                                            | 5             | 5               | 5                | 0              |
| connection.ts retryNow during an attempt; useOrderEvents fake clock (09)     | 10            | 7               | 9                | 1              |
| Go: adminevents check()/Publish, SSE past server timeouts, rename guard (09) | 12            | 11              | 11               | 1              |
| shared schema stock minimum (03)                                             | 2             | 2               | 2                | 0              |
| **Stage 4**                                                                  | **68**        | **58 (85%)**    | **62**           | **6**          |

Killable mutants the draft missed: 62 − 58 = 4 of 62 (about 1 in 15).

## Mutants that survived the first draft

- **server.ts: the recorder's `throw Response.error()` replaced by `return` (the request passes through). Survived.**
  Why: the draft fetched the API's address (localhost:8080), where
  nothing listens; a passthrough failed with ECONNREFUSED, which looks
  just like the refusal. Fix: stand up a real local server and assert it
  is never reached. Killed.
- **vitest.setup.ts: the afterEach check never throws. Survived against the committed suite; not observable there.**
  Every committed test now answers its requests, so no committed test
  can fail through this check; a test that left a request unanswered
  would fail the suite. Checked instead with a deliberate probe
  (uncommitted): a test that sends `fetch(…).catch(() => undefined)`
  fails with "No MSW handler answered GET …" with the check, passes
  without it. The reviewer's reproduction 1 (a stray
  `api.request("/v1/admin/unhandled-probe")` appended to lib/api.ts)
  now fails OrderDetailPage.test.tsx (2 of 12 tests) instead of passing.
- **image-cache.ts: the cancel moved after `setQueryData`. Survived; equivalent.**
  TanStack's manual write sets the query's revert state to the written
  state (query.js, `#revertState = action.manual ? newState : void 0`),
  so a cancel after the write reverts to the write. This is what the
  production comment relies on.
- **ProductVariantsStep.tsx: `stock > VARIANT_STOCK_MAX` → `stock >= 0`. Survived; equivalent.**
  `typedStock` only returns non-negative integers, and every such number
  up to the maximum passes the schema, so a schema error on a number
  already implies it is above the maximum.
- **ProductVariantsStep.tsx: the over-max text shown without a schema error. Survived.**
  Why: every draft case pressed "Periksa" first, so the error existed
  in all of them. Fix: assert the field has no error before the check
  (only "Saat dibuka: 1.000.005."). Killed.
- **useQuickStockChange.ts: `await cancelQueries` → `void cancelQueries`. Survived; equivalent.**
  The cancel's revert runs synchronously inside `cancel()`, so the
  write that follows lands after it either way.
- **connection.ts: `signal.addEventListener("abort", forwardStop)` removed (stop no longer reaches the attempt). Survived.**
  Why: the draft asserted the attempt's signal was aborted after
  `elapse(120_000)`, by which time the 60 s idle timer had aborted it
  anyway. The test checked the end state, not when. Fix: assert it right
  after `stop()`. Killed.
- **connection.ts: `settled()` skipped after a stream that ended normally. Survived.**
  Why: the draft's listener test only used attempts that failed (the
  catch path, which settles separately). Fix: mix streams that open and
  close with failures. Killed (the run signal's listeners pile up).
- **connection.ts: `settled()` moved after the stop check in the catch. Survived; not observable.**
  On the stop path the run is over and its signal already aborted: a
  stale `abandonAttempt` only aborts a finished attempt, and retryNow
  starts nothing after stop.
- **adminevents handler.go: the read-deadline lift removed (timeouts test alone). Survived; not observable on Go 1.26.**
  `net/http` clears the connection's read deadline itself when it
  starts the background read of a request without a body
  (`startBackgroundRead`, server.go:684), so the server's ReadTimeout
  no longer reaches a GET stream. The write-deadline mutant is killed
  by the same test. The handler comment ("The server's ReadTimeout would
  end the stream") overstates it on this Go; reported to backend-engineer,
  no change made.

## Draft failures that were the test's fault (4)

- **useQuickStockChange "with a detail refetch on its way": the refetch never ran.** The draft started it with `queryClient.query(…)` on the dashboard's client, whose `staleTime` keeps the seeded copy fresh, so no fetch happened. The saved-stock case passed for nothing; only the second case ("lets the refetch land") failed and showed it. Fixed with `staleTime: 0` and an assertion that one fetch is running before the change. The image-cache test uses a plain `QueryClient` (staleTime 0) and asserts the same.
- **ReportsPage stale-line tests read the page before it re-rendered** after `refetchQueries` (the observer's update arrives on a later tick). Failed 2 of 3 runs; now waits for the second call and the line.
- **OrderActionsPanel: `cancel_reason: "seller"`** is not a cancel reason; the badge never read "dibatalkan toko". Now `seller_cancelled`.
- **image-cache: `fetchQuery`** is deprecated in this TanStack version (lint error); now `query`.

## Existing tests changed on purpose (12, as listed)

order-actions.test.ts (6: 500 and the network now "uncertain"; NETWORK_ERROR, CLIENT_TIMEOUT, 503 TIMEOUT and 500 sentences), OrderActionsPanel.test.tsx (2: Proses after a 500 now refetches and says "uncertain"; Batalkan's retry case uses 429), useOrderAction.test.tsx (1: 429), photo-uploads.test.ts (refusal text and step "start"), ProductConflictReview.test.tsx (archived text), ProductForm.conflict.test.tsx (archived text). Each failed on the new base for that reason only, then passed with the new expectation. Plus the three tests the MSW guard caught (unanswered `POST /v1/auth/web/refresh` after a 403), which now answer it.

No test deleted. No production bug found in this round.

## Errata (stage-4 re-review)

- The ReadTimeout comment in `adminevents/handler.go` ("no change made" above) was rewritten by backend-engineer in 8e227c4f, together with ADR 0009: the lift stays as defence, and the comment now says the server's ReadTimeout does not reach this stream.
- The totals mix 56 TypeScript and 12 Go mutants; split, they are TypeScript 56 / 47 / 51 / 5 and Go 12 / 11 / 11 / 1.
