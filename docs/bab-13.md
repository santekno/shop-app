# Bab 13 — Fondasi React Native & Expo

Branch: `bab-13` (from `bab-12` @ `9e29191a`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | react-native-engineer (frontend-engineer for one `packages/shared` change) | pass, **iOS build not run** | `apps/mobile` (new): Expo SDK 58 (React Native 0.88.1, Hermes, New Architecture), Expo Router with typed routes and the `goshop://` scheme, `app.config.ts` with `com.santekno.goshop` on both platforms, `eas.json` with the three profiles of design D15 (development: dev client, iOS simulator; preview: Android APK, iOS simulator build; production: AAB, iOS archive). Artikel 01 and 13–15 are README sections; 02–12 and 14 are code. Every gate check ran on the whole app: `typecheck`, `lint`, `build` (`expo export` for both platforms), `npx expo-doctor` (20/20), `npx expo prebuild --platform all --clean` (both platforms, inspected: identifiers, scheme, fonts, icons, splash, cleartext and ATS per profile). Android: release APKs built with Gradle and installed on an Android 13 emulator (`Pixel_2_API_33`), the last one at `fd147e37` (33.4 MB, arm64-v8a). **iOS: no native build has run.** This machine has no Xcode; the author chose an EAS cloud build, which needs the author's Expo login, and that has not happened yet (task 18.4 stays open) |
| 1 unit tests | test-engineer | pass | Jest with `jest-expo` 58 and Testing Library for React Native, Expo Router screens through `renderRouter` on the real `app/` directory, a typed fake `fetch` at the network boundary that fails a test on an unanswered request or a held answer never released. 293 tests in `apps/mobile`, every file at 100%; 544 in `packages/shared` (the new `credentials` option); web and admin unchanged (1216, 1446); Go unchanged (97.7%). Mutation-checked: 87 mutants in stage 1 (drafts killed 79, 85 after fixes, 2 not observable), 29 in the stage-4 round (29 killed by the draft). No production bug; one test-only fix outside the chapter (below) |
| 2 DB audit | database-auditor | no SQL change | `apps/api` and `api/openapi.yaml` are unchanged since `bab-12` |
| 3 integration | integration-engineer, react-native-engineer | pass for Android; **iOS not verified** | The existing Go integration and Playwright suites ran unchanged in the cold gate (below). Maestro flows arrive in Bab 15 (`make test-mobile-e2e` says so). The native check was done by hand on the Android emulator against a Compose API stack: the 12-item catalog checklist, deep links, dark mode switched at run time, offline at launch, the keyboard, cleartext per profile — and it found seven bugs, all fixed (What the gate changed) |
| 4 quality review | quality-review | pass | two reviewers (the app; tests, shared and workspace). Round 1: mobile blocked 6 (the iOS dev profile was a device build, the sort button announced as a link, errors not announced on either platform, Kategori kept its own copy of the error wording, the AI record out of date, a wrong README path), tests blocked 2 (the product card never tested with a photo, the sort sheet's modal presentation never checked). Fixed in `815fd840..37c678b6`; round 2 passed |

**Verified SHA:** `cce98cc2f61317c0e526ea5fb98c8817742f3fb0` (2026-10-31), for Android and everything that is not a native iOS build. Stages 0–1 ran on the heads named above, stage 4 on `63cdafa1` and `37c678b6`.

`make verify` ran from a cold stack (`docker compose down -v` first, its own Compose project on host ports 2xxxx) at the verified SHA and passed every stage in 968 s: build (including `expo export` of the app for both platforms), lint, `docker-build` of every image, Go unit coverage 97.7%; 544 tests in `packages/shared`, 293 in `apps/mobile`, 1446 in `apps/admin` and 1216 in `apps/web`; 1216 top-level Go tests in the integration run (4596 with subtests) and 142 Playwright tests passed, 0 skipped; `make scan` clean. The Go integration suite under `-race` was not run again: `apps/api` is byte-identical to `bab-12`'s race-verified `81d6297d`. An earlier cold run at `63cdafa1` (before the stage-4 fixes) also passed, in 1500 s.

**Per-commit, read honestly.** The chapter was built in parallel worktrees and cherry-picked onto `bab-13`, and the tests came after all of stage 0, so most `feat` commits do not pass the unit tests at their own snapshot. A release build could not be made from `a78175eb` (artikel 05, NativeWind) until `418c74bb`, because of the Babel plugin below; `expo export` and the type checks passed all along, which is how it went unnoticed until the first Gradle build. The stage-4 test commits fix the 11 tests the mobile fixes changed on purpose in their own article's commit, so the commits between `815fd840` and `37c678b6` are not green on their own.

### What the gate changed

- **Stage 0, Expo's `fetch` sends cookies** (artikel 12, `dfa79203`): Expo SDK 58 replaces the global `fetch` with `expo/fetch`, which defaults to `credentials: "include"` and keeps a native cookie jar. The shared API client assumed "no `credentials` = no cookie", which holds only in a browser. The client takes a `credentials` default now; the mobile client sends `"omit"`, web and admin are unchanged. A `packages/shared` path, changed by the agent acting as frontend-engineer for this one commit (orchestrator's brief), backwards compatible (stage 4 read every caller).
- **Native check on the Android emulator, seven bugs:**
  - no release build could be made since NativeWind (`418c74bb`, artikel 05): `react-native-css-interop`'s Babel preset uses `@babel/plugin-transform-react-jsx` without declaring it; `expo export` found it through pnpm's `NODE_PATH`, Gradle, Xcode and EAS do not;
  - the catalog went blank when page 2 arrived (`3a5a4df3`, artikel 06): the card's `flex-1` (`flex: 1 1 0%`) collapsed in a list cell; now `grow`;
  - offline at launch looked like a server error and never recovered (`5f1e1689`, artikel 06): `expo-network`'s listener reports only changes; the state is read once at start;
  - the keyboard covered the list on Android (`dd2f0174`, artikel 10): under edge-to-edge the window does not resize; `KeyboardAvoidingView` pads on both platforms;
  - a cold `goshop://produk/<slug>` had no back button (`fd147e37`, artikel 08): `unstable_settings.anchor = "(tabs)"`;
  - choosing a category dropped the search and the sort (`72fba693`, artikel 14): navigate with `merge`;
  - the Kategori tab spun forever offline (`f937afd5`, artikel 14), visible only once the offline fix let queries pause;
  - and while measuring artikel 07, FlashList opened scrolled to the end and kept the old offset for a new filter (`c9753981`).
- **Stage 4, blocking:** the iOS `development` profile was a device build (needs a paid Apple account) → `simulator: true` (`815fd840`); the sort button was announced as a link (`<Link asChild>` passes `role="link"`) → `role="button"` and a 48 dp target (`740d6964`); `accessibilityRole="alert"` announces nothing in RN 0.88 → Android live regions plus `AccessibilityInfo.announceForAccessibility` on iOS (`65429830`); Kategori kept its own copy of the error wording that artikel 14 teaches against → it reuses the app's status states (`aee9bfb4`); the AI record and a README path were out of date (`aee9bfb4`, `a10edb5e`, `cce98cc2`); the product card was never tested with a photo and the modal presentation never checked (`6de7dd0b`, `024c2ebd`).
- **Stage 4, advice applied:** production builds require an `https://` API URL (`815fd840`); the start-up network read cannot overwrite a newer event and cannot reject unhandled (`65429830`); `useProductList` returns only what the list reads, with `products` memoised (`65429830`).
- **A date bomb outside the chapter** (`63cdafa1`): two `apps/web` `PaymentPage` tests ("pays again from the page…", "says why paying again failed") fail from 2026-10-31, because `vi.useRealTimers()` also un-fakes `Date` and the fixture's payment deadline `2026-10-31T00:00:00Z` passed. The test now keeps a fake `Date` at the fixture's `NOW`. **It is fixed on `bab-13` only:** `bab-11` and `bab-12` still carry the two tests and fail them when run after that date. Adding the fix to those branches would break the rule that `bab-(N-1)` is an ancestor of `bab-N` unless the later branches are rebased and force-pushed; that is the author's call. A clock-shift run (stage 4) found no other date-bound fixture in shared, web and admin up to +730 days.
- **Cold gate:** the run at `37c678b6` stopped on one Go integration test, `TestRace_ResetTokens`, timing out at 60 s while five concurrent password resets hashed under a host load average of about 14; `apps/api` is byte-identical to `bab-12`'s race-verified code, and the test passed alone three times in about 21 s. The gate was run again (above).

## Decisions

The app's decisions are in `apps/mobile/README.md` (one section per article).

- **Expo SDK 58 managed workflow with prebuild (CNG):** `android/` and `ios/` are generated, never committed; EAS builds the binaries. No web target.
- **iOS via EAS cloud** (author decision; no Xcode on this machine): the `preview` and `development` profiles build for the simulator, so no Apple developer account is needed. `eas init` cannot edit a dynamic `app.config.ts`; `extra.eas.projectId` is added by hand once the project exists.
- **NativeWind 4.2.7 with Tailwind 3** (NativeWind 5 is a release candidate): one styling idiom from artikel 06 on, colour roles shared with the web in `src/theme/colors.js`; `useTheme()` only where React Navigation needs colours.
- **FlashList for the catalog** (artikel 07): measured on the emulator against `ScrollView` and `FlatList`; memory and mounted cells decided it, smoothness did not.
- **Inter embedded at build time, Lucide icons as SVG** (artikel 11): the same icon set as the web; no runtime font loading.
- **Cleartext only outside production:** `usesCleartextTraffic` and the ATS local-network exception for `development`/`preview`; production requires `https://`.
- **Network:** `expo-network` drives TanStack Query's `onlineManager`, `AppState` its `focusManager`.
- **New dependencies:** Expo SDK 58 modules at the SDK's pinned versions, `nativewind` 4.2.7, `react-native-css-interop` 0.2.7, `tailwindcss` 3.4.19 (the web stays on 4), `@shopify/flash-list` 2.3.2, `react-native-svg` 15.16.0, `@tanstack/react-query` (catalog); Jest 30 with `jest-expo` 58 and Testing Library for React Native. No Go change; sdk stays at v0.2.0.

## Notes

- **Ownership:** `dfa79203` changed `packages/shared` (frontend-engineer's path) under the orchestrator's brief, which gave that agent both roles for artikel 12; test-engineer's stage-1 commit added the mobile test devDependencies and changed the lockfile (side effects: `@sinclair/typebox` 0.27 → 0.34 as an optional peer of `@hookform/resolvers` in web and admin, and the `expo-router` peer hash), reported to frontend-engineer; `63cdafa1` is a test-only change in `apps/web`. The orchestrator resolved the cherry-pick integration of the parallel worktrees (`187ec0fa..d2daf2c3`, `72e583e6..424acd5e`) through a react-native-engineer agent. No test agent changed production behaviour.
- **All device findings are from the Android emulator.** iOS paths read correctly (stage 4 read every `Platform` branch) but none has run: the simulator build reaching `http://localhost:8080`, the iOS announcement, the interactive keyboard dismissal, the cold deep link with the anchor, "Tutup" on the sort sheet, Hermes' Rupiah formatting on iOS, and FlashList on iOS.
- **Load:** the mobile Jest suite needs 30 s per test and 5 s for Testing Library's waits when it runs alongside web and admin in `make test-unit`.

## Deferred

- **The iOS native build and its simulator check** (task 18.4): an EAS cloud build with the `preview` profile once the author logs in to Expo, then installing the simulator `.app` needs Xcode (or a Mac with it).
- **`report_http_test.go:188`** can fail once if a run crosses midnight WIB (stage-4 advice, integration-engineer).
- **The README's artikel-13 limits of React Native DevTools on SDK 58:** Expo Network shows no body for chunked responses (every product page), failed requests do not appear, the Performance panel recorded an empty timeline in Chromium.
- **The app icon and splash** are drawn from a mark made for the course; an official logo would replace them before a release.
- **The onboarding screen:** the artikel-15 challenge (`apps/mobile/README.md`); there is deliberately no onboarding route.

## Articles → code

| Artikel | Topic | feat / fix / docs | tests |
|---|---|---|---|
| 01 | React vs React Native | `32c51e7f`, `d2daf2c3`, `5d76a6ff` (README) | — |
| 02 | Expo setup, Expo Go and the Android emulator | `b5fabb85`, `815fd840` | `35a1e4ce`, `672cc4b7` |
| 03 | Core components | `187ec0fa` | `4c2e3da0`, `6de7dd0b` |
| 04 | StyleSheet and flexbox | `67be4195` | — (the grid was replaced in artikel 06; the README keeps it) |
| 05 | NativeWind | `a78175eb`, `418c74bb` | `0a968028` |
| 06 | FlatList for the product list | `72e583e6`, `3a5a4df3`, `5f1e1689`, `65429830` | `fd144f88`, `a8bde4f4` |
| 07 | ScrollView vs FlatList vs FlashList | `c9753981`, `20dad72b` | `fd144f88`, `a8bde4f4` |
| 08 | Expo Router | `63896e1a`, `fd147e37` | `8285c897` |
| 09 | Tabs, stack and modal | `9e22d12f`, `740d6964` | `fdf64f37`, `024c2ebd` |
| 10 | Safe area, status bar and keyboard | `1469ea42`, `dd2f0174`, `a10edb5e` | `a6d080b7` |
| 11 | Fonts and icons | `42ef0b86`, `e1f95224`, `a156c5fe` | `67ce62a9` |
| 12 | Sharing code with the web | `dfa79203` (shared), `4d678820` | `533110f3` |
| 13 | React Native DevTools | `5285a9fe` (README) | — (a recorded session) |
| 14 | Scaffold a screen with AI, then adapt it | `45e925f9`, `086d01e2`, `72fba693`, `f937afd5`, `aee9bfb4`, `cce98cc2` | `287b2e51`, `37c678b6` |
| 15 | Recap + challenge: an onboarding screen | `51099778`, `4becf7de` (README) | — |
