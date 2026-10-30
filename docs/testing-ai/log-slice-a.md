# AI test log — Bab 12 stage 1, TypeScript slice A

Prompt: `<scratch>/ai-test-prompt-ts-slice-a.md` (the AI prompt that generated these tests).
Method: after the first full draft of each test file, break one guarded line
of production code at a time (`<scratch>/mutate.py`: replace, run that
file's tests, `git checkout` the file, check the production diff is empty).
"Killed by draft" = the first draft already failed on the mutant. Every
mutant the draft did not kill is listed with why, and what changed.

## packages/shared

| File                       | Mutants tried | Killed by draft | Killed after fix | Equivalent |
| -------------------------- | ------------- | --------------- | ---------------- | ---------- |
| api/admin-orders.ts        | 4             | 2               | 3                | 1          |
| api/admin-reports.ts       | 1             | 1               | 1                | 0          |
| schemas/shipment.ts        | 3             | 3               | 3                | 0          |
| api/auth.ts (admin header) | 1             | 1               | 1                | 0          |

- **api/admin-orders.ts — `cursor: cursor ?? undefined` → `cursor`. Survived; equivalent.**
  `toQueryString` (api/url.ts:25) already skips `null`, so the `?? undefined`
  only satisfies the type of `query`. No test can tell them apart; none added.
- **api/admin-orders.ts — `getAdminOrder` stopped passing `{ signal }`. Survived.**
  Why: the draft tested the signal for `listAdminOrders` and `shipOrder` and
  assumed `getAdminOrder` shared their code path; it does not (its own
  `api.request` call). Fix: a signal test for `getAdminOrder` too.

## apps/admin — pure functions copied or new

| File                                                          | Mutants tried | Killed by draft | Killed after fix |
| ------------------------------------------------------------- | ------------- | --------------- | ---------------- |
| app/route-crumbs.ts                                           | 1             | 1               | 1                |
| features/auth/permissions.ts                                  | 1             | 1               | 1                |
| features/auth/return-to.ts (`/daftar` no longer an auth page) | 1             | 1               | 1                |
| lib/api-form-errors.ts (product patterns)                     | 1             | 1               | 1                |
| lib/error-message.ts                                          | 1             | 1               | 1                |
| lib/format-date.ts                                            | 1             | 1               | 1                |
| config.ts                                                     | 1             | 1               | 1                |
| lib/query-client.ts                                           | 1             | 1               | 1                |

Copied from apps/web and adapted (not written fresh): return-to, auth-errors,
refresh-lock and api-form-errors tests. The web copy of return-to.test.ts
asserts the storefront's rule (`/daftar` → `/`), which is wrong for the
dashboard (`AUTH_PAGES` is only `/masuk`); it was changed before the first
run, after diffing the two return-to.ts files, to assert `/daftar` is kept.
A copied test is only as right as the diff you read before copying it.

## apps/admin — session and interceptor (artikel 01, 08)

| File                             | Mutants tried | Killed by draft | Killed after fix |
| -------------------------------- | ------------- | --------------- | ---------------- |
| features/auth/session-manager.ts | 6             | 6               | 6                |
| features/auth/auth-client.ts     | 4             | 4               | 4                |

session-manager.test.ts is the storefront's test file ported from a fake
`fetch` to MSW (a script removed the guest-cart `onStart` cases and renamed
helpers), plus new cases for `X-GoShop-Client: admin` and
`refreshAfterForbidden`. auth-client.test.ts was written fresh on MSW. All
mutants killed on the first draft; the ported half had already been
mutation-hardened in Bab 10, so this says little about the AI's own draft.

## apps/admin — orders, reports, realtime pure functions

| File                                                  | Mutants tried | Killed by draft | Killed after fix | Equivalent |
| ----------------------------------------------------- | ------------- | --------------- | ---------------- | ---------- |
| features/orders/order-status.ts                       | 4             | 4               | 4                | 0          |
| features/orders/order-actions.ts                      | 7             | 7               | 7                | 0          |
| features/orders/order-timeline.ts                     | 3             | 3               | 3                | 0          |
| features/orders/api/queries.ts                        | 3             | 3               | 3                | 0          |
| features/reports/report-params.ts                     | 9             | 7               | 8                | 1          |
| features/reports/report-format.ts                     | 5             | 4               | 4                | 1          |
| features/reports/report-summary.ts + chart-rows.ts    | 4             | 4               | 4                | 0          |
| features/reports/api/queries.ts                       | 1             | 1               | 1                | 0          |
| features/realtime/sse-parser.ts                       | 12            | 9               | 12               | 0          |
| features/realtime/backoff.ts                          | 2             | 2               | 2                | 0          |
| features/realtime/recent-ids.ts                       | 2             | 2               | 2                | 0          |
| features/realtime/order-event.ts                      | 3             | 3               | 3                | 0          |
| features/realtime/toasts.ts + order-events-context.ts | 4             | 4               | 4                | 0          |

- **report-params.test.ts, before any mutant: the draft itself was wrong.**
  It expected the 90-day preset ending 2026-10-30 to start on 2026-08-01;
  the right answer (and the code's) is 2026-08-02. The AI did date
  arithmetic in its head; the test failed on the first run and the
  expectation was corrected. A failing new test is not always a bug in the
  code.
- **report-params.ts — `date.getUTCDate() === d` → `true`. Survived; equivalent.**
  Every impossible day ("02-30", "04-31", "10-00") rolls over into another
  month, so the month check alone already refuses it. The day comparison
  cannot change the result; no test can kill it.
- **report-params.ts — `toTime < fromTime` → `toTime < fromTime - 1`. Survived; a bad mutant.**
  Times are whole days apart, so `- 1` ms changes nothing. Replaced by a
  mutant that removes the check (`if (false)`), which the draft killed.
  Counted once, as killed.
- **report-format.ts — drop `if (from === to) return formatDate(from)`. Survived; equivalent here.**
  `Intl.DateTimeFormat#formatRange` with two equal dates already prints one
  date in Node's ICU. The guard protects browsers whose ICU might not; a
  unit test under Node cannot see the difference.
- **sse-parser.ts — the `afterCR` join of "\r" | "\n" across chunks removed. Survived.**
  Why the draft missed it: its test split "\r" and "\n" around a _blank_
  line. Read as two endings, the extra "\n" is one more empty line, and an
  empty line with no data dispatches nothing, so both readings give the
  same events. The test asserted something both branches produce. Fix: put
  the split between two `data:` lines of one event; two endings would cut
  the event in two (`["a\nb"]` vs `["a", "b"]`).
- **sse-parser.ts — "\r\n" inside one chunk read as two endings. Survived.**
  Same cause: the CRLF test only had CRLF before blank lines. Fix: a
  two-line event with CRLF between its lines.
- **sse-parser.ts — `eventType` not reset after a dispatch. Survived.**
  Why: every draft case that dispatched a typed event ended the test there,
  or followed it with another typed event. Fix: an `event: order` frame
  followed by one without `event:` must be "message" again.

## apps/admin — the event stream (artikel 09)

| File                              | Mutants tried | Killed by draft | Killed after fix |
| --------------------------------- | ------------- | --------------- | ---------------- |
| features/realtime/event-stream.ts | 12            | 12              | 12               |
| features/realtime/connection.ts   | 15            | 14              | 15               |

- **Tooling, not the code: three draft cases of event-stream.test.ts failed on MSW.**
  (1) A stream whose first bytes had not arrived yet never resolved `fetch`
  through MSW 3, so "wait for onOpen" hung; the API always sends
  ": connected" first, and the tests now do too. (2) A body that errors
  half-way reached the client as a clean end through MSW's interceptor, so
  "cut off mid-way" saw `{ kind: "closed" }` instead of NETWORK_ERROR. (3)
  Fake timers plus MSW 3's socket-level interception crashed undici
  (`assert(!this.aborted)`). Those cases (and every connection.ts case,
  which are all clock-driven) pass a `fetch` of their own
  (`fetchStream` in src/test/msw/events.ts, which errors the body on abort
  like the browser does). The first version of that fake ignored the abort
  signal, so the idle timer fired and the test still hung for 5 s: a fake
  that does less than the real thing can make a correct guard look broken.
- **connection.ts — `retryNow()` with no wait running aborts the live stream instead of doing nothing. Survived.**
  Why the draft missed it: it asserted "no second fetch". Aborting the
  stream stops the loop, so there is no second fetch either way: the test
  checked a number both behaviours produce. Fix: assert the live stream's
  signal is not aborted, the status stays "live", and a later event still
  arrives.

## apps/admin — shell and auth components (artikel 01, 08)

| File                                                         | Mutants tried | Killed by draft | Killed after fix | Equivalent |
| ------------------------------------------------------------ | ------------- | --------------- | ---------------- | ---------- |
| app/Breadcrumbs.tsx                                          | 3             | 3               | 3                | 0          |
| app/SkipLink.tsx                                             | 2             | 2               | 2                | 0          |
| app/useRouteFocus.ts                                         | 3             | 3               | 3                | 0          |
| app/DashboardLayout.tsx, AppHeader.tsx, Sidebar.tsx          | 4             | 3               | 3                | 1          |
| app/RouteErrorPage.tsx                                       | 2             | 2               | 2                | 0          |
| app/App.tsx                                                  | 1             | 1               | 1                | 0          |
| app/routes.tsx                                               | 2             | 2               | 2                | 0          |
| features/auth/components/RequireStaff.tsx                    | 4             | 4               | 4                | 0          |
| features/auth/components/NoAccessPage.tsx                    | 2             | 2               | 2                | 0          |
| features/auth/components/UserMenu.tsx + RoleChangeNotice.tsx | 4             | 4               | 4                | 0          |
| features/auth/components/LoginPage.tsx                       | 4             | 4               | 4                | 0          |
| features/auth/SessionProvider.tsx + hooks                    | 4             | 4               | 4                | 0          |

- **Sidebar.tsx — `end={end}` dropped from the NavLinks. Survived; equivalent in React Router 7.18.**
  The draft does assert "Ringkasan" is not `aria-current` on /pesanan, and
  it is not, with or without `end`: NavLink never matches "/" as a prefix
  of another path (its prefix rule needs a "/" right after the link's
  path). navigation.ts's comment ("without it Ringkasan would be marked on
  every page") describes React Router 6.0, not this version. Harmless; no
  test can kill it.
- **Tooling: `mutate.py` first read the routes.tsx mutant (`path: "masuk"` → `"login"`) as SURVIVED.**
  The mutant makes RequireStaff redirect /masuk to /masuk?kembali=… for
  ever; the Vitest worker crashed with SIGABRT, printing no "failed"
  line, and the script looked for that word. It now decides by exit code,
  and every earlier SURVIVED was re-run: the routes mutant is KILLED, the
  others (listed as equivalent above) still survive.
- **SessionProvider.test.tsx — a draft assertion about TanStack Query, not the code, was wrong.**
  It expected `gcTime: 0` to drop the login mutation (and the password in
  its `variables`) while the hook was still mounted. A mutation is
  collected only once nothing observes it; the draft failed, and the test
  now asserts the variables are there while mounted and gone after
  unmount. That version also kills the "gcTime default" mutant; the first
  one would have passed against the mutant had it been "fixed" by
  deleting the assertion instead.
- Copied, not written: the six components/ui tests (Button, Card,
  DropdownMenu, FormAlert, StatusMessage, TextField) are the storefront's,
  unchanged; the components differ only in comments. Not mutation-checked
  again here.

## apps/admin — orders components and hooks (artikel 06, 08)

| File                                                                     | Mutants tried | Killed by draft | Killed after fix |
| ------------------------------------------------------------------------ | ------------- | --------------- | ---------------- |
| components/OrderQueueTable.tsx + OrdersPage.tsx + OrderStatusTabs.tsx    | 9             | 9               | 9                |
| components/OrderDetailPage.tsx + OrderItemsTable.tsx + OrderTimeline.tsx | 4             | 4               | 4                |
| components/OrderActionsPanel.tsx + components/ui/ConfirmDialog.tsx       | 10            | 10              | 10               |
| components/ShipOrderForm.tsx                                             | 2             | 2               | 2                |
| components/OrderShippingLabelPage.tsx                                    | 4             | 4               | 4                |
| hooks/useOrderAction.ts                                                  | 5             | 5               | 5                |

No mutant survived the first draft here, but the drafts did not pass on
their first run either, and every failure was the test's fault:

- OrderDetailPage.test.tsx looked for "Dibayar" anywhere on the page; the
  timeline says it too. Scoped to the title block.
- OrderShippingLabelPage.test.tsx expected an error after a 503, but the
  dashboard's API client retries a GET on 503 (lib/api.ts) and the retry
  got the success the handler gave the second call. The draft did not
  know the client's retry rule; it now uses a 500, which is not retried.
  It also asserted `toBeEnabled()` on the button `findByRole` returned at
  once, before the order arrived.
- useOrderAction.test.tsx passed a `Response` where the handler takes an
  `OrderList`: a test-helper type confusion the type checker would have
  caught had the draft been type-checked before it was run.

## apps/admin — reports components, realtime components and hooks (artikel 07, 09)

| File                                                                | Mutants tried | Killed by draft | Killed after fix | Equivalent / not observable |
| ------------------------------------------------------------------- | ------------- | --------------- | ---------------- | --------------------------- |
| reports/components/ReportsPage.tsx                                  | 4             | 3               | 4                | 0                           |
| reports/components/ReportControls.tsx                               | 8             | 6               | 7                | 1                           |
| reports/hooks/useReportParams.ts                                    | 2             | 1               | 2                | 0                           |
| reports/components/SalesDataTable.tsx + TopProductsTable.tsx        | 2             | 2               | 2                | 0                           |
| reports/components/PeriodChart.tsx                                  | 3             | 3               | 3                | 0                           |
| reports/components/RecentSalesTile.tsx + dashboard/OverviewPage.tsx | 2             | 2               | 2                | 0                           |
| realtime/components/OrderEventsProvider.tsx                         | 3             | 3               | 3                | 0                           |
| realtime/components/OrderToasts.tsx                                 | 8             | 6               | 7                | 1                           |
| realtime/components/UnreadOrdersBadge.tsx + ConnectionStatus.tsx    | 3             | 3               | 3                | 0                           |
| realtime/hooks/useOrderEvents.ts                                    | 7             | 6               | 6                | 1                           |
| hooks/useLateHeadingFocus.ts                                        | 1             | 1               | 1                | 0                           |

- **ReportsPage.tsx — the revenue chart always drawn as `revenue`, never `cumulative`. Survived.**
  Why: the draft checked the toggle by the heading and the note above the
  chart, which come from the page's own `cumulative` state, not from what
  the chart draws. In jsdom the chart has no size and draws nothing, so
  the draft could not look at it and did not try. Fix: a sized
  ResizeObserver for that test, and the y axis must reach Rp600 rb (the
  running total) only after the toggle.
- **ReportControls.tsx — `setChoosingCustom(false)` dropped from the "adjust state on new params" block. Survived.**
  Why: the only draft case that closes an unapplied date form chose a
  preset, and the preset's own handler also clears it: the two lines
  cover for each other there. Fix: open the form, then change the URL
  from outside (a link, Back); the form must close.
- **ReportControls.tsx — `setChoosingCustom(false)` dropped from the preset handler. Survived; not observable.**
  Every preset click goes through `onChange`, which always gives
  `params` a new identity (useReportParams sets `pending`), and that
  clears the flag in the same render. The handler's line is redundant.
- **useReportParams.ts — `pending` ignored (`params: fromUrl`). Survived.**
  Why: the draft asserted the new value right after `act()`, but inside
  `act` the memory router's navigation finishes too, so the URL already
  had it; "shown before the URL" was asserted at a moment when both
  agree. Fix: record every render's (value, URL) pair and require a
  render where the value is new and the URL still old.
- **OrderToasts.tsx — the `relatedTarget` check on blur removed. Survived; not observable here.**
  Moving the focus between two controls of the stack fires blur (unpause)
  and focus (pause) in one batch; the timer effect sees "paused" both
  before and after, so no time is lost. Kept the test ("keeps counting…")
  because it does pin the user-visible behaviour, but it does not prove
  the guard.
- **OrderToasts.tsx — "Lihat pesanan" no longer dismisses. Survived.**
  Why: in the draft harness the toasts lived on the "/" route, so
  following the link unmounted them: the toast vanished with or without
  the dismiss, and the test asserted only the new URL. Fix: the harness
  is one catch-all route, as the layout is, and the test asserts the
  stack is gone after the click.
- **useOrderEvents.ts — `removeEventListener("online", …)` dropped on unmount. Survived; not observable.**
  The leaked listener calls `retryNow()` on a stopped connection, which
  is a no-op (`wake` is null). An attempted fix (spy on
  `window.removeEventListener` and expect an "online" removal) passed
  against the mutant too: TanStack Query's onlineManager removes its own
  "online" listener at the same moment. **Deleted as tautological**; the
  test keeps only "no request after unmount, even on online".
- **useReportParams.test.tsx — a draft case was removed because it found a real bug** (see the
  bug section of the report): "two updates in one tick both apply"
  failed against the production code. The repro is kept out of the
  commit, as the brief asks.

## Totals

|                                            | Mutants tried | Killed by first draft | Killed after fix | Equivalent / not observable |
| ------------------------------------------ | ------------- | --------------------- | ---------------- | --------------------------- |
| packages/shared                            | 9             | 7                     | 8                | 1                           |
| admin pure helpers (copied + new)          | 8             | 8                     | 8                | 0                           |
| session manager + interceptor              | 10            | 10                    | 10               | 0                           |
| orders / reports / realtime pure functions | 59            | 53                    | 57               | 2                           |
| event stream + connection                  | 27            | 26                    | 27               | 0                           |
| shell + auth components                    | 35            | 34                    | 34               | 1                           |
| orders components + hooks                  | 34            | 34                    | 34               | 0                           |
| reports + realtime components + hooks      | 43            | 36                    | 40               | 3                           |
| **All**                                    | **225**       | **208 (92%)**         | **218**          | **7**                       |

The 17 mutants the first drafts missed fall into a few patterns, roughly
in order of how often:

1. **Asserting something both branches produce** (8): the CR/LF parser
   cases, `retryNow` with no wait ("no second fetch" either way), the
   toast link (unmounted by the route change anyway), the pending report
   params (URL already caught up inside `act`), the ReportControls flag
   (two lines covering for each other).
2. **Asserting the state instead of the output** (1): the cumulative
   chart toggle checked the heading, not what was drawn.
3. **Assuming a sibling code path was covered** (1): `getAdminOrder`'s
   own signal.
4. **Never exercising the second step** (1): the parser's event type
   reset after a typed event.
5. Equivalent or unobservable mutants (7), listed with their reasons;
   one "fix" for them was itself tautological and was deleted.

Draft tests that failed on the first run for reasons in the test, not the
code: 9 (date arithmetic, TanStack's mutation GC, the API client's GET
retry, a `findBy` resolving before the button enabled, two ambiguous text
queries, a helper given the wrong type, Recharts' first ArrowRight, MSW
streaming quirks). Two more cases timed out only under `make test-unit`'s
parallel load (App, ReportsPage); the setup now gives async queries 3 s.

## A bug the tests found (kept out of the commit)

`useReportParams().update` (apps/admin/src/features/reports/hooks/useReportParams.ts:35-38)
loses all but the last of several updates made in the same tick:
`setSearchParams(fn)` in React Router 7.18 calls `fn` with the
`searchParams` of the render that created `setSearchParams`, not with the
URL after the previous call, so the second navigation overwrites the
first. Repro: at `/laporan`, inside one `act`, `update({ group: "month" })`
then `update({ range: { kind: "preset", days: 90 } })`. Expected URL
`?rentang=90&kelompok=bulan`; actual `?rentang=90` (and `params` then
falls back to group "day" once that URL arrives). The same pattern in
`useProductTableParams` (features/products/hooks/useProductTableParams.ts:70-80,
slice B) fails the same way (`update({q:"kaos"})` + `update({status:"active"})`
→ `?status=aktif`, the search lost), although its comment says "two
updates in a row both count". No current control calls `update` twice
per event, so nothing user-visible breaks today.

## Errata (stage-4 review)

- The bad `toTime < fromTime - 1` mutant in report-params.ts was replaced by one the draft killed and is "counted once, as killed", but the totals counted it as a draft miss: the draft killed **209**, not 208, of the 225.
- Pattern 1 ("asserting something both branches produce") lists 6 examples, not 8.
- The `asyncUtilTimeout` mentioned near the end was raised again later, to 10 s (commit "give async queries 10 s on a heavily loaded machine").
- `<scratch>/…` paths point at the agent's working copies; the committed versions are `docs/testing-ai/prompt-slice-a.md` and `docs/testing-ai/mutate.py`.
- "The 17 mutants the first drafts missed" above is 16 after the 209 correction.
