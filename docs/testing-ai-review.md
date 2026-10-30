# Generating tests with AI, then reviewing them (Bab 12 artikel 13)

Every unit test in this repository is written by the `test-engineer` agent (`.claude/agents/test-engineer.md`), an AI. That makes the question of this article a practical one: how do we know a generated test is any good? A test that passes proves nothing by itself; it only shows that the test agrees with the code. This page records how Bab 12's tests were generated and reviewed, with the real numbers, the real misses and the two real bugs the tests found. Nothing here is polished into a success story.

## What was generated

| Part                                                                                                                 | Prompt                                                                                                 | Tests                                    | Review record                                            |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| Go, Bab 12 backend (admin table, product version, stock adjustments, SSE, admin cookie, seed role)                   | a brief per pass, written by the orchestrator, plus a per-function list from backend-engineer's report | `apps/api/**/*_test.go` (coverage 97.7%) | mutation counts per pass (below)                         |
| TypeScript slice A: dashboard shell, auth, orders, reports, realtime, plus the Vitest and MSW setup (artikel 10, 11) | [`testing-ai/prompt-slice-a.md`](testing-ai/prompt-slice-a.md), verbatim                               | 750 admin tests                          | [`testing-ai/log-slice-a.md`](testing-ai/log-slice-a.md) |
| TypeScript slice B: the products feature (artikel 02–05) and the slice-A updates                                     | a follow-up message to the same agent; it split the work into four parallel runs, one per article      | 1,377 admin tests in all, 533 shared     | [`testing-ai/log-slice-b.md`](testing-ai/log-slice-b.md) |
| Stage-4 fix round: tests for the review's findings and the fixes it led to                                           | a brief from the orchestrator listing every finding and the exact assertions the fixes need            | 1,432 admin tests in all                 | [`testing-ai/log-stage4.md`](testing-ai/log-stage4.md)   |

The prompt is the AI box's first part ([ai-rules.md](ai-rules.md)). The raw output was not kept file by file: every test file was reworked by the agent itself after its own review. What the logs keep instead is the part that matters for this article, **every place the first draft was weak**, why, and what changed.

## How the tests were reviewed: mutation checks

Coverage says a line ran; it does not say a test would notice if the line were wrong. So after the first full draft of each test file, the agent broke the production code one guarded line at a time and ran that file's tests:

1. replace one expression (a `<` with `<=`, a guard with `true`, a call removed);
2. run only the tests of that file;
3. **killed**: a test failed, so the tests guard that line. **Survived**: every test still passed, so no test notices that change;
4. restore the file with `git checkout` and check the production diff is empty.

The runner is [`testing-ai/mutate.py`](testing-ai/mutate.py). It decides by the test run's exit code. Its first version looked for the word "failed" in the output, and a mutant that made a worker crash (an endless redirect) printed no such word, so it was counted as survived. Every earlier "survived" was run again after the fix. The tool used to review the tests had a bug of its own, which is the point of reviewing tools too.

A surviving mutant has two possible meanings: the test is weak, or the mutant changes nothing anyone can observe (an **equivalent** mutant). Each survivor in the TypeScript logs is labelled with one of the two, with the reason.

## The numbers

|                            | Mutants tried | Killed by the first draft            | Killed after the fix | Equivalent / not observable |
| -------------------------- | ------------- | ------------------------------------ | -------------------- | --------------------------- |
| TS slice A                 | 225           | 209 (93%)                            | 218                  | 7                           |
| TS slice B                 | 339           | 316 of 336 run against a draft (94%) | 333                  | 6                           |
| TS stage-4 fix round       | 68            | 58 (85%)                             | 62                   | 6                           |
| Go, pass 1 (B1–B7)         | 61            | not recorded per draft               | 59                   | 2                           |
| Go, pass 2 (B8–B11)        | 42            | not recorded per draft               | 42                   | 0                           |
| Go, pass 3 (stage-2 fixes) | 10            | not recorded per draft               | 10                   | 0                           |

A mutant that survives the draft is not always a miss: an equivalent mutant cannot be killed by any test. Leaving those out, slice A's drafts survived 16 mutants, 7 of them equivalent, so they **really missed 9 of the 218 killable ones**; slice B's drafts survived 20, at most 6 of them equivalent, so **at least 14 of about 330**. That is roughly one guarded line in 22 to 24 that the AI's first draft did not really test, although every draft passed and coverage was high. The Go numbers come from the test agent's report after each pass; no per-mutant log was kept for them, and they record only the final result. The TypeScript runs were asked to log the draft separately, which is why only they can say how good a first draft is.

The counts above were corrected in the stage-4 review (the first version of this page said "one in twelve to sixteen", counting equivalent mutants as misses); the logs carry an errata note for the same corrections.

## What the review found that the mutation checks did not

Mutation checks only test the guards someone thought to break. The stage-4 review (the `quality-review` agent, reading the whole chapter) found two problems the logs above had missed, both in the tests' foundations rather than in one assertion:

1. **"An unhandled request fails the test" was false.** The setup said MSW's `onUnhandledFrame: "error"` makes a test fail when it sends a request no handler answers. It only failed the request: the code under test saw a network error, handled it, and the test stayed green. Three tests were silently relying on that (each sent an unanswered session refresh after a 403). Now every unhandled request is recorded and the test fails in `afterEach`, and those three tests answer the refresh.
2. **A focus test passed against broken code.** The conflict review is meant to keep keyboard focus on its heading. In a browser the focus was lost every time, because the heading of the loading state was replaced by a different heading when the data arrived. The test never saw a loading state: MSW answered so fast that React skipped it. The fix was in the component (one heading for every state), and the new test delays the answer by 100 ms.

The second one is the lesson for everyone using a mock API: **a mock that is faster than any real network can hide every bug that lives in the time between the request and the answer.**

## Why the first drafts missed

The misses fall into a few patterns, in this order of frequency:

1. **Asserting something both branches produce** (most of them). Examples from the logs:
   - The SSE parser test split `\r` and `\n` across two chunks, but around a _blank_ line. Read as one line ending or as two, a blank line dispatches nothing, so both readings gave the same events. The fix puts the split between two `data:` lines of one event.
   - `retryNow()` with no wait running was checked with "no second fetch". Aborting the live stream (the mutant) also leads to no second fetch.
   - A toast's "Lihat pesanan" link was checked by the new URL only. In the test's harness the route change unmounted the toasts anyway, so a toast that was never dismissed vanished too.
   - The stock panel test was even _named_ "…even after a refetch moved it", but nothing refetched between opening the editor and saving. So a mutant that compares the count with the live stock instead of the stock seen at opening survived: the two were the same number. The title promised what the body did not do.
2. **Asserting state instead of output.** The cumulative chart toggle was checked through the heading the page renders, not through what the chart drew (in jsdom the chart had no size and drew nothing; the fix gives it one).
3. **Assuming a sibling code path was covered.** `getAdminOrder`'s abort signal was not tested because `listAdminOrders`' was.
4. **Never exercising the second step.** The parser's event type was not reset after a typed event, and no draft case sent an untyped event after a typed one.
5. **Asserting an absence before it could have happened**, for example "no DELETE" checked right after a cancel, before the request could have been sent.

None of the misses was a test that could never fail. One test was deleted as **tautological**: a spy on `removeEventListener("online")` passed against the mutant too, because TanStack Query's own online manager removes its "online" listener at the same moment.

## When the draft failed, and the test was wrong

A new test that fails is not always a bug in the code. In slice A, 9 draft tests failed on their first run for reasons in the test:

- date arithmetic done in the AI's head (a 90-day range ending 2026-10-30 starts on 2026-08-02, not 08-01);
- a wrong belief about when TanStack Query garbage-collects a mutation;
- not knowing that the dashboard's API client retries a GET on 503;
- a `findBy` that resolved before the button it found was enabled;
- text queries that matched twice ("Dibayar" is also in the timeline);
- MSW 3 quirks with streamed bodies and fake timers.

Copied tests need the same review. The storefront's `return-to` test asserts the storefront's rule (`/daftar` counts as an auth page), which is wrong for the dashboard, so it had to be changed before its first run. A copied test is only as right as the diff you read before copying it.

## The bugs the tests found

Two real production bugs came out of this review. Each was reported with a reproduction kept out of the test commit, fixed by the code's owner, and then pinned by a test:

1. **Several URL-state updates in one event lost all but the last** (`useReportParams`, `useProductTableParams`). React Router 7's `setSearchParams(fn)` hands `fn` the search params of the render that created it, not the URL after the previous call. The product hook's comment even promised the opposite. Fixed in `7c7f9d61`.
2. **An inactive order query that was still fetching stayed "fresh" after a realtime event** (`invalidateOrderQueries`). A detail page reopened within `staleTime` showed the order from before the event. Fixed in `ec11b315`.

Neither was visible in a browser yet: no control calls `update()` twice, and the detail page race needs exact timing. That is the kind of bug only a precise test finds.

## A checklist for reviewing an AI-generated test

- Break the line the test claims to guard. If the test still passes, the test is weak, or the line does nothing observable; decide which and write it down.
- For each assertion, ask whether the wrong implementation would produce the same value. Boundary values, two inputs instead of one, and "the second step" catch most of these.
- Assert what the user (or the caller) sees, not the component's own state.
- Treat a failing new test as a question, not a verdict: the code may be right and the test's expectation wrong.
- Keep the review in writing: the prompt, the misses, what changed. That record is what lets someone else trust the tests.
