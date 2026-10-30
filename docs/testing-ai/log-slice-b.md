# AI test log — Bab 12 stage 1, TypeScript slice B

Same method as slice A (`ai-test-log-slice-a.md`): after the first full
draft of each file, break one guarded line of production code at a time
(`<scratch>/mutate.py`, decided by the test run's exit code), restore it
with `git checkout`, and check the production diff is empty. Base:
`bab-12` @ c2a5de55, plus 7c7f9d61 (the update()-twice fix).

## Slice A tests brought up to date (artikel 09, 14, 15)

Three slice-A tests failed on the new base, and all three for the right
reason: the behaviour changed on purpose (reports refetched with orders;
`invalidateQueries(…, { cancelRefetch: false })`). They asserted the exact
`invalidateQueries` call, so the change broke them loudly rather than
passing silently. Rewritten to the new rules, plus new cases.

| File                                                            | Mutants tried | Killed by draft | Killed after fix | Not observable |
| --------------------------------------------------------------- | ------------- | --------------- | ---------------- | -------------- |
| orders/api/queries.ts (invalidateWithoutCancelling)             | 3             | 2               | 2                | 1              |
| orders/components/OrdersPage.tsx (loadingMore while refetching) | 1             | 1               | 1                | 0              |
| realtime/hooks/useOrderEvents.ts (reports, delay, unmount)      | 4             | 4               | 4                | 0              |
| realtime/order-event.ts (changesSalesReport)                    | 1             | 1               | 1                | 0              |
| reports/components/ReportsPage.tsx (ReportBody memo)            | 1             | 1               | 1                | 0              |
| reports/hooks/useReportParams.ts (7c7f9d61's `latest`)          | 3             | 3               | 3                | 0              |

- **queries.ts — the second invalidation pass with `cancelRefetch` back to its default. Survived; not observable.**
  The second pass runs only after the first pass has joined (and awaited)
  the running fetch, so by then nothing is running to cancel.
- **A draft assertion found a bug (kept out of the commit):** "an
  inactive running query is marked invalidated" failed. See the bug
  section at the end.
- **ReportBody's memo** is checked by counting calls of `chartSummary`
  (wrapped with `vi.mock`, actual behaviour kept): it runs on every render
  of the body. A memo is otherwise invisible to a user-level test; the
  count is the one place this file asserts on an implementation detail,
  and the mutant (memo removed) is what it is there to kill.

## How slice B was produced

The product feature (artikel 02–05, about 7,900 lines) was split into four
parallel AI runs, one per article, each in its own git worktree with its
own copy of the mutation runner, working only on new test files with
article-specific names, so their commits could be cherry-picked side by
side. Each wrote its own log section; they follow below as written.

## apps/admin + packages/shared — the product table (artikel 02)

Written by a fork in its own worktree (branch `worktree-agent-ac71bcf1e18f2f89c`,
commit 2cdad7fb on top of cbcb79b3). Same method: break one guarded line
at a time (`<scratch>/mutate-art02.py`, by exit code), restore with
`git checkout`, production diff checked empty after every batch.

| File                                                                         | Mutants tried | Killed by draft | Killed after fix | Not observable |
| ---------------------------------------------------------------------------- | ------------- | --------------- | ---------------- | -------------- |
| features/products/product-table-params.ts                                    | 16            | 16              | 16               | 0              |
| features/products/hooks/useProductTableParams.ts (incl. 7c7f9d61's `latest`) | 7             | 7               | 7                | 0              |
| hooks/useDebouncedCallback.ts                                                | 5             | 5               | 5                | 0              |
| features/products/hooks/useCategoryOptions.ts                                | 2             | 2               | 2                | 0              |
| features/products/api/queries.ts (keepPreviousData)                          | 1             | 1               | 1                | 0              |
| packages/shared api/admin-products.ts (listAdminProducts)                    | 2             | 2               | 2                | 0              |
| components/product-columns.tsx                                               | 6             | 6               | 6                | 0              |
| components/ProductTable.tsx (incl. the body's memo)                          | 7             | 5               | 6                | 1              |
| components/TablePagination.tsx                                               | 5             | 5               | 5                | 0              |
| components/ProductFilters.tsx                                                | 6             | 6               | 6                | 0              |
| components/ProductSearchField.tsx                                            | 5             | 4               | 5                | 0              |
| components/ProductsPage.tsx                                                  | 5             | 5               | 5                | 0              |
| components/ProductStatusBadge.tsx + ProductThumbnail.tsx                     | 4             | 4               | 4                | 0              |
| **artikel 02**                                                               | **71**        | **68 (96%)**    | **70**           | **1**          |

- **ProductTable.tsx — the caption always says "naik". Survived.**
  Why: the draft's only caption case sorted ascending, so the word the
  mutant hard-codes was the right one. The test checked one value of a
  two-valued thing. Fix: a descending case ("Stok turun").
- **ProductTable.tsx — `!isSortableColumn(next.id)` dropped from onSortingChange. Survived; not observable.**
  Only sortable columns render a sort button (the others have
  `enableSorting: false`), so TanStack never hands this handler an
  unsortable column from the UI. The guard is a type narrowing as much
  as a check; no user path reaches its other branch.
- **ProductSearchField.tsx — the `text !== draftRef.current` check before a debounced search. Survived.**
  Why: every draft case let the debounce fire with the text last typed,
  where the check is always true. It matters only when the field's text
  changes without a keystroke while a search waits: a search arriving
  from outside (Back, "Hapus filter") inside the 300 ms. Fix: type, let
  the URL bring another search before the wait ends, and assert the old
  text is never sent.
- **useProductTableParams.ts — the `useMemo` on the query string broken (a new dependency every render). Killed, but by a crash.**
  A new params object every render makes the "a new URL arrived" check
  set state on every render: React gives up ("Too many re-renders") and
  the test file fails. The draft's identity test ("same object while the
  query string is the same") would also have caught it; the kill is
  real, but not by the assertion written for it.

Draft failures that were the test's fault, not the code's (2):

- useCategoryOptions.test.tsx expected the categories sorted by name;
  `buildCategoryTree` keeps the API's order. The AI assumed a sort the
  code never claimed. The fixture now lists children before their
  parents, which is what the depth-first flattening is for.
- ProductFilters.test.tsx compared a child category's option text with
  three ASCII spaces; the indent is wide Unicode spaces (a `<select>`
  cannot be padded). Now asserted as "starts with whitespace", the
  parent's text as not.

No test deleted as tautological. No production bug found in artikel 02.
The update()-twice cases (coordinator's 2, 5, 6) pass on 7c7f9d61, and
the `latest.base === fromUrl` guard and the ref update are both killed
(by "builds on a link that arrived" and "two updates in one act").

## Artikel 03: the product form (fork worktree `agent-a615bf78ee0bc446f`)

The method was the same as before: `mutate-art03.py`, a copy of `mutate.py` aimed at this fork's worktree, decides each mutant by the test run's exit code. After every run the production diff was empty.

| File                                                                                        | Mutants tried | Killed by draft | Killed after fix | Equivalent |
| ------------------------------------------------------------------------------------------- | ------------- | --------------- | ---------------- | ---------- |
| shared schemas/product.ts (`productSchema`, `variantSchema`, `toProductSlug`, `stockLevel`) | 14            | 12              | 13               | 1          |
| shared api/admin-products.ts (get, create, update, archive)                                 | 5             | 5               | 5                | 0          |
| features/products/product-form.ts                                                           | 10            | 10              | 10               | 0          |
| hooks/useUnsavedChangesGuard.ts                                                             | 6             | 6               | 6                | 0          |
| features/products/hooks/useProductMutations.ts                                              | 5             | 4               | 5                | 0          |
| features/products/api/queries.ts                                                            | 1             | 1               | 1                | 0          |
| components/ui/Field.tsx                                                                     | 3             | 3               | 3                | 0          |
| components/ui/Textarea.tsx                                                                  | 1             | 1               | 1                | 0          |
| components/StepIndicator.tsx                                                                | 2             | 2               | 2                | 0          |
| components/ProductForm.tsx                                                                  | 11            | 9               | 10               | 1          |
| components/ProductInfoStep.tsx                                                              | 5             | 5               | 5                | 0          |
| components/ProductVariantsStep.tsx                                                          | 5             | 5               | 5                | 0          |
| components/ProductReviewStep.tsx                                                            | 3             | 3               | 3                | 0          |
| components/ProductCreatePage.tsx                                                            | 1             | 1               | 1                | 0          |
| components/ProductEditPage.tsx                                                              | 5             | 5               | 5                | 0          |
| components/ArchiveProductButton.tsx                                                         | 4             | 4               | 4                | 0          |
| **Artikel 03**                                                                              | **81**        | **76**          | **79**           | **2**      |

### Mutants that survived the first draft

- **product.ts: the duplicate-SKU check compares the raw SKU instead of the trimmed, upper-cased one. Survived; equivalent.**
  The array refinement runs on values that have already been parsed: a variant whose SKU is valid has its SKU transformed even when another of its fields fails. The draft's case was "kph-m" and " KPH-M ", once with every variant valid and once with a sibling field invalid. Both reach the check already upper-cased. A raw SKU reaches it only when the element is not an object, and then the key is "". No test can tell the two apart.
- **product.ts: `if (slug[200] === "-") return cut;` dropped. Survived.**
  Why the draft missed it: its "boundary on the limit" case was one 200-letter word. A single word has no hyphen, so the fallback `cut.replace(/-[^-]*$/, "")` changes nothing, and both code paths give the same slug. The test asserted something both branches produce.
  Fix: two whole words that fill exactly 200 characters, then a third. With the guard both words are kept; without it the second word is wrongly dropped.
- **ProductForm.tsx: `Math.min` → `Math.max` for the step the API's field errors open. Survived.**
  Why: every draft case had API errors on one step only, so min and max are the same number.
  Fix: one VALIDATION_FAILED with a slug error (step 1) and a price error (step 2). The form must open "Info dasar" with the slug focused, and the price error must still be there one step later.
- **ProductForm.tsx: `target <= step` → `target < step` (clicking the current step). Survived; equivalent.**
  With target equal to step, the validation loop `for (index = step; index < target; …)` runs zero times and then shows the same step. The two branches do the same thing.

- **useProductMutations.ts — `removeCachedImage` dropped from useDeleteProductImage. Not in the first run.**
  The draft's 404 case asserted only `isSuccess`, which does not see the cache, so it would not have killed this mutant. I added the mutant while rewriting the test (see the flaky test below). The test now seeds the product with two photos and asserts that one remains, and it kills the mutant.

### Discarded mutant

`queries.ts`: I passed `listCategories` an extra `headers` option, cast `as never`, meaning to model "the categories request carries the session's token". The function ignores options it does not know, so this mutant does not model the fault. It was "killed" for some other reason I did not chase. It is left out of the counts.

### Draft failures that were the test's fault, not the code's

- `variantSchema` with `price: NaN`: the draft expected the Indonesian "Tulis harga dalam rupiah tanpa koma…". The union `number | string` refuses NaN before the transform runs, so the message is zod's generic "Invalid input". The draft guessed where the error would come from. The test now asserts only that NaN is refused. NaN cannot come from a form input, which always gives a string.
- Two failures came from ambiguous queries, not from the code:
  - The draft took every `option` on the page as the category list, but the status `<select>` has options too.
  - ProductReviewStep's section and its scrolling table both carry the name "Varian (n)", so a by-name lookup found two regions.
- `renderCreate(categories = () => categoriesResponse(…))`: TypeScript inferred the parameter's type from the default value. Tests that passed a deferred answer or an error then failed the type check, though they ran fine. The parameter is now typed as `Answer`.

- **Flaky under load:** the useProductMutations cases read `isSuccess` or `error` right after `await act(() => mutateAsync(…))`. They passed alone, then failed in the full coverage run. The mutation's state reaches the hook on TanStack's next notify batch, which `act` does not always flush, so the draft assumed an ordering the library does not promise. These assertions now sit inside `waitFor`.

### Observations (not bugs)

- ProductReviewStep: the "Varian (n)" section and its `TableContainer` are both labelled by the same heading, so a screen reader meets two regions with the same name. TopProductsTable had the same pattern in slice A.
- `productSchema` gives an English "Invalid input" for a non-string, non-number price (NaN). The UI cannot produce one.

## artikel 04 — product photos (fork, worktree `agent-a2e12c460831393b`)

Same method as slice A: after the first full draft of each file, one
guarded line of production code is broken at a time
(`<scratch>/mutate-art04.py`, a copy of `mutate.py` pointed at this
worktree; KILLED = the file's tests exit non-zero), restored with
`git checkout`, and the production diff checked to be empty after every
run (it was).

Tools: a fake XMLHttpRequest (`src/test/fake-xhr.ts`) for the PUT to
storage, because XHR is what reports upload progress; stand-ins for
`Image.decode`/`naturalWidth` and `URL.createObjectURL`/`revokeObjectURL`
(`src/test/products-photos.ts`), which jsdom lacks; MSW for every API
call (start, confirm, delete). useProcessingPoll runs on fake timers and
does **not** go through MSW (slice A showed MSW 3 and fake timers do not
mix): its detail query gets a query function of the test's own, and each
refetch the poll asks for is counted as one call of it. The "Periksa lagi"
case of ProductPhotosSection uses fake timers with no request at all.

| File                                                      | Mutants tried              | Killed by draft                  | Killed after fix | Equivalent |
| --------------------------------------------------------- | -------------------------- | -------------------------------- | ---------------- | ---------- |
| shared schemas/product-image.ts                           | 8                          | 7                                | 7                | 1          |
| shared api/admin-products.ts (start/confirm/delete image) | 2                          | 2                                | 2                | 0          |
| upload-to-storage.ts                                      | 16 (1 added after the fix) | 13 of 15                         | 16               | 0          |
| photo-file-check.ts                                       | 5                          | 5                                | 5                | 0          |
| photo-uploads.ts                                          | 16                         | 16                               | 16               | 0          |
| hooks/useProcessingPoll.ts                                | 7                          | 7                                | 7                | 0          |
| api/image-cache.ts                                        | 2                          | 2                                | 2                | 0          |
| hooks/useProductMutations.ts (useDeleteProductImage only) | 2                          | 2                                | 2                | 0          |
| hooks/usePhotoUploads.ts                                  | 18 (1 added after the fix) | 15 of 17                         | 17               | 1          |
| components/ProductPhotosSection.tsx                       | 5                          | 4                                | 5                | 0          |
| components/PhotoTile.tsx                                  | 3                          | 2                                | 3                | 0          |
| components/PhotoPicker.tsx                                | 4                          | 3                                | 4                | 0          |
| components/ui/Progress.tsx                                | 1                          | 1                                | 1                | 0          |
| **All**                                                   | **89**                     | **79 of 87 run against a draft** | **87**           | **2**      |

Survivors of the first drafts:

- **product-image.ts — `startsWith`'s length check without the offset (`bytes.length >= signature.length`). Survived; equivalent.**
  Reading past the end of a Uint8Array gives `undefined`, which never
  equals a signature byte, so a too-short header is refused by the byte
  comparison anyway. The length check is redundant; no test can tell.
- **upload-to-storage.ts — a 3xx counted as success (`status < 400`). Survived.**
  Why: the draft tested 200/201/299 as success and 4xx/5xx as failures,
  but nothing just outside the 2xx band. Fix: 199, 300 and 304 must be
  "rejected". A 1xx mutant was added after the fix and is killed by it
  (not run against the draft).
- **upload-to-storage.ts — `code === "ExpiredToken"` dropped. Survived.**
  Why: the draft's ExpiredToken body said "The provided token has
  expired.", so the message test (`/expired/i`) already made it
  "expired": the case asserted something the other branch also produces.
  Fix: an ExpiredToken whose message does not contain the word.
- **usePhotoUploads.ts — cancelling during "confirming" discards the photo anyway (`confirming = false`). Survived.**
  Why: the draft asserted "no DELETE" synchronously right after the
  cancel; the DELETE, when sent, goes out a few microtasks later, so the
  assertion could not fail. It checked the absence at a moment when
  absence was guaranteed. Fix: pick another photo after the cancel and
  wait for its start request; a DELETE from the cancel would have been
  sent before it. A second mutant (`discardOnCancel` never cleared) was
  added after the fix; it is killed.
- **usePhotoUploads.ts — settled uploads not removed from the list on the next pick. Survived; not observable.**
  `photoTiles` already leaves settled uploads out, `usedPhotoSlots` does
  not count confirmed ones, and their previews are revoked when they
  settle. The removal only frees memory; the hook's results are the same.
- **ProductPhotosSection.tsx — the heading focused on the first render (`focusRequest > 0` dropped). Survived.**
  Why: every draft case asserted focus after an action (a delete, a
  cancel), none at mount. Fix: rendering the section leaves the focus on
  the body.
- **PhotoTile.tsx — a ready photo without sizes drawn as `<img>` from `image.url`. Survived.**
  Why: the draft had no ready photo with an empty `variants` list. Fix:
  such a tile shows no picture.
- **PhotoPicker.tsx — the drag depth allowed below zero. Survived.**
  Why: the draft's "one leave too many" case ended with a drag _in_,
  which sets the highlight whatever the count is; the bug only shows on
  the next drag _out_, which stays highlighted. Fix: enter, then leave,
  after the extra leave.

Draft failures that were the test's fault, not the code's:

- PhotoTile.test.tsx (8 cases): the draft found the tile's picture with
  `getByRole("img")`, but an `<img alt="">` is decorative and has no
  `img` role; it now looks the picture up by tag, with a comment why.
  And button names such as "Tutup kaos.jpg" come out as "Tutupkaos.jpg"
  from the DOM accessibility library (the sr-only label's leading space
  is dropped, as in slice A); the names are matched with `\s*`.
- usePhotoUploads.test.tsx expected an uploading photo the API had not
  listed yet to be "pending"; "pending" is an API photo never confirmed.
- usePhotoUploads.test.tsx, four cases at first: the DELETEs that
  unmounting sends for uploads still in flight arrived _after_ their test
  ended and landed in the next test's request log (and on reset
  handlers). An afterEach in the file now unmounts and waits for those
  DELETEs while the test's handlers still answer them.
- usePhotoUploads.test.tsx flaked once under coverage: the XHR is created
  in the same tick the "uploading" phase is dispatched, before React has
  rendered it; the test waited for the XHR and then read the phase. It
  now waits for both. Five further runs passed.
- useDeleteProductImage.test.tsx read `isSuccess` right after
  `mutateAsync` resolved, before the hook re-rendered; it flaked under
  coverage and now waits for it.

No test was deleted as tautological. No production bug was found.

Scope notes: `hooks/useProductMutations.ts` stays at 40% here because
only `useDeleteProductImage` is artikel 04's; its create/update/archive
hooks are artikel 03's. Shared `api/admin-products.ts` is at 64% with
these tests alone (the image functions are covered); its other
functions belong to the artikel 02/03/05 tests.

## apps/admin + packages/shared — artikel 05 (stock and edit conflicts)

Written by a fork of the test-engineer in its own worktree, from the
"artikel-05" list as replaced by "artikel-05 REWORK (55d9af61)". Same
method: one guarded line broken at a time (`<scratch>/mutate-art05.py`,
exit code decides), restored with `git checkout`, production diff empty
after every run.

| File                                                                   | Mutants tried | Killed by draft | Killed after fix | Equivalent |
| ---------------------------------------------------------------------- | ------------- | --------------- | ---------------- | ---------- |
| shared api/admin-products.ts (`adjustVariantStock`)                    | 2             | 2               | 2                | 0          |
| shared schemas/product.ts (`stockLevel`)                               | 1             | 1               | 1                | 0          |
| features/products/stock.ts                                             | 14            | 14              | 14               | 0          |
| features/products/product-merge.ts                                     | 21            | 20              | 21               | 0          |
| features/products/product-form.ts (version, 409s, `variantsToArchive`) | 4             | 4               | 4                | 0          |
| components/StockBadge.tsx                                              | 2             | 2               | 2                | 0          |
| hooks/useQuickStockChange.ts                                           | 5             | 5               | 5                | 0          |
| components/StockPanel.tsx (StockEditor inside)                         | 13            | 11              | 13               | 0          |
| components/ProductConflictReview.tsx                                   | 9             | 9               | 9                | 0          |
| components/ProductForm.tsx (409 review, `latest`)                      | 7             | 6               | 7                | 0          |
| components/ProductVariantsStep.tsx (`loaded`)                          | 5             | 5               | 5                | 0          |
| components/ProductReviewStep.tsx (`loaded`)                            | 2             | 2               | 2                | 0          |
| **artikel 05 total**                                                   | **85**        | **81 (95%)**    | **85**           | **0**      |

- **product-merge.ts — the "combined" stock offered for any conflict, not only stock. Survived.**
  Why the draft missed it: its only non-stock conflict was the product
  name ("Kaos A" vs "Kaos B"), and a combined value is only computed for
  whole numbers, so the name could never get one: the test asserted
  `combined` undefined for a reason other than the guard. Fix: a price
  conflict (99.000 vs 95.000 from 89.000), whole numbers on every side,
  must still offer no combined value.
- **StockPanel.tsx — a count checked against the live stock (`variant.stock`) instead of the stock seen when the editor opened (`seen`). Survived.**
  Why: the draft's test was even _named_ "…even after a refetch moved
  it", but nothing refetched between opening the editor and saving, so
  the live and the seen stock were the same number. The title promised
  what the body did not do. Fix: the test now invalidates the product
  query while the editor is open (the row shows 10), and the POST must
  still say `expected: 12`.
- **StockPanel.tsx — "Pakai …" offered when the result would pass 1.000.000. Survived.**
  Why: the draft covered the lower bound (below 0) and the difference 0,
  not the upper bound. Fix: a move to 999.999 with a count of 20 must
  hide "Pakai".
- **ProductForm.tsx — "Terapkan perubahan saya" without `reset(review.merge.latest)` first. Survived.**
  Why: the draft checked the next PUT's `version`, but the merged values
  carry `version: latest.version` themselves, so the version is right
  either way. What the first reset really does is make the latest
  product the form's starting point. Fix: the server archived variant L
  meanwhile; after "Terapkan", the review step must not list L under
  "Diarsipkan saat disimpan" (the save is not what archives it). Against
  the mutant it does.

Draft failures that were the test's fault, not the code's:

- ProductConflictReview.test.tsx: eight cases looked a part up with
  `getByRole("region", { name })`, but each part's `<section>` and the
  table container inside it are both labelled by the same heading, so
  there are two regions of that name (the same pattern as
  TopProductsTable in slice A). The helper now takes the section, the
  first match.
- ProductConflictReview.test.tsx: the draft expected the status label
  "Draft"; the dashboard's label is "Draf".
- Not a draft failure but worth recording: slice A's ReportsPage
  "cumulative" test timed out once (7 s) in this fork's full-suite
  coverage run, while three other forks were running Vitest on the same
  machine; it passes alone. Load, not code.

No test was deleted as tautological. No production bug found in this
scope.

## Slice B totals

|                                                            | Mutants tried | Killed by first draft            | Killed after fix | Equivalent / not observable |
| ---------------------------------------------------------- | ------------- | -------------------------------- | ---------------- | --------------------------- |
| slice-A tests brought up to date (09/14/15, report params) | 13            | 12                               | 12               | 1                           |
| artikel 02 — product table                                 | 71            | 68                               | 70               | 1                           |
| artikel 03 — product form                                  | 81            | 76                               | 79               | 2                           |
| artikel 04 — product photos                                | 89            | 79 of the 87 run against a draft | 87               | 2                           |
| artikel 05 — stock and conflicts                           | 85            | 81                               | 85               | 0                           |
| **All**                                                    | **339**       | **316 of 337 (94%)**             | **333**          | **6**                       |

The same patterns as slice A, in roughly the same proportions: most
misses were a test asserting something both branches produce (a case on
the boundary missing, one long word instead of two, errors on only one
step, a "refetch" test that never refetched), a few an absence asserted
before it could have happened, a few an edge never exercised. Not one
miss was a test that could not fail at all; every one was a weak
assertion that a second input fixed.

Run-time, not code: on the shared machine (load average above 30),
`make test-unit`'s parallel run with coverage pushed the 50-variant
ProductForm cases, lazy pages and the chart past Vitest's 5 s per test,
and the storefront's AccountNav/Providers tests past Testing Library's
1 s default. apps/admin and apps/web now give a test 20 s and the
storefront's async queries 3 s; no assertion changed. Two consecutive
`make test-unit` runs after that were green.

## Bugs found in slice B (kept out of the commits)

1. **FIXED by ec11b315.** **`invalidateOrderQueries` left an inactive query that was fetching
   un-invalidated** — apps/admin/src/features/orders/api/queries.ts:104-122
   (`invalidateWithoutCancelling`). For an active query the first
   `invalidateQueries(…, { cancelRefetch: false })` joins the running
   fetch and awaits it, so the second pass marks the query after that
   fetch. An inactive query is not refetched, so the first pass resolves
   at once and the second pass marks it _before_ the running fetch ends;
   the fetch's success then clears `isInvalidated`. Repro: a
   `client.query({ queryKey: orderKeys.detail("o-9"), queryFn })` whose
   answer is still pending, then `invalidateOrderQueries(client)`, then
   resolve the answer. Expected `getQueryState(…).isInvalidated === true`
   (the data predates the event); actual `false`, so the detail page
   reopened within `staleTime` (10 s) shows the pre-event order without a
   refetch. Likely fix: for each running query, wait for its fetch
   (`query.promise`) before the second invalidation. Owner:
   frontend-engineer.

   **After the fix (ec11b315):** the repro is now a committed test
   (`calls` stays 1, `isInvalidated` true after `await running; await
done`), plus a failing running fetch (`done` resolves, no refetch,
   still invalidated) and "does not settle before the inactive query's
   fetch is answered". Mutants on the new `query.promise` wait:

   | Mutation                                              | Result |
   | ----------------------------------------------------- | ------ |
   | `await done` removed (the wait on the running fetch)  | KILLED |
   | `done: undefined` (the promise not captured)          | KILLED |
   | `done: query.promise` (a failure no longer swallowed) | KILLED |

   3 tried, 3 killed by the first draft. The draft that found the bug
   was the right test all along; it only had to wait for the fix.
