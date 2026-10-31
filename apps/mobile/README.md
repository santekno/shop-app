# GoShop mobile

`apps/mobile` is GoShop for Android and iOS: one React Native codebase, built with Expo, that talks to the same API as the storefront (`apps/web`) and the dashboard (`apps/admin`). It arrives in Bab 13; this file has one section per article, like `apps/admin/README.md` does for the dashboard.

## Running it

```bash
make up                                  # the API on http://localhost:8080 (or make dev-api)
pnpm --filter @goshop/mobile start:go    # Metro + a QR code for Expo Go on a phone
pnpm --filter @goshop/mobile android     # build a development app, install it on the emulator, start Metro
```

Artikel 02 below explains what each of these does and what to install first.

| Setting               | Kind  | Where                                                            | Meaning                                                                                                                                                                                                                                                               |
| --------------------- | ----- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | build | `apps/mobile/.env.local`, the shell, an EAS environment variable | The API as the **device** reaches it. Baked into the JavaScript bundle, so it is public. Unset means this machine: `http://10.0.2.2:8080` on the Android emulator, `http://localhost:8080` on the iOS simulator. A `production` EAS build refuses to start without it |
| `EAS_BUILD_PROFILE`   | build | set by EAS                                                       | Which `eas.json` profile is being built; `app.config.ts` reads it (cleartext `http://` and iOS's local-network exception outside `production`, artikel 06)                                                                                                            |
| `APP_VARIANT`         | build | the shell                                                        | Names a profile for a command run by hand when EAS is not involved, such as `APP_VARIANT=production npx expo prebuild`; `EAS_BUILD_PROFILE` wins when both are set, and neither means `development`                                                                   |

# Bab 13: fondasi React Native & Expo

## React vs React Native: apa yang sama, apa yang berbeda (artikel 01)

The storefront and the dashboard are React apps that render to the **DOM**: `<div>`, `<button>`, CSS. This app is React that renders to **native views**: on Android a `View` becomes an `android.view.View` (a `ViewGroup`), on iOS a `UIView`. React itself (components, props, state, hooks, context) is the same library in all three apps; what changes is the renderer underneath it and everything a browser used to give for free.

### The mental model

| Idea                                    | What it means                                                                                                                                                                                                                                                      | Go comparison                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **One React, two renderers**            | `react` decides _what_ the UI is (the component tree, state, re-renders). `react-dom` turns that into HTML elements; `react-native` turns it into platform views. Your components talk to React; only the leaves (`<div>` vs `<View>`) belong to a renderer        | One `interface`, two implementations: the caller does not change when the implementation does        |
| **Two threads, not one page**           | The JavaScript runs in Hermes (React Native's JS engine) on its own thread; the native UI runs on the platform's main thread. A heavy loop in JavaScript freezes your logic and gestures handled in JS, not the whole operating system                             | A goroutine doing the work while the main goroutine owns the UI                                      |
| **No browser around the app**           | There is no `window`, `document`, `localStorage`, cookie jar, URL bar or CSS cascade. Each of those is replaced by a module (`expo-secure-store`, Expo Router …) or simply does not exist                                                                          | A binary instead of a CGI script: nothing is provided by a host you did not link in                  |
| **A release is a binary, not a deploy** | The web apps ship a Docker image and every visitor gets the new version on the next page load. The phone app ships an `.apk`/`.aab`/`.ipa` through a store, users update when they update, and old versions stay in use for months: the API must keep serving them | Shipping a CLI to users rather than running a server: you cannot recall the copies already out there |

### Same and different, in this repository

| Concern           | `apps/web` (Next.js) and `apps/admin` (Vite)                                                                                               | `apps/mobile` (Expo)                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Components        | HTML elements: `<div>`, `<p>`, `<button>`, `<img>`, `<a>`                                                                                  | Core components: `<View>`, `<Text>`, `<Pressable>`, `<Image>`; links are `<Link>` from Expo Router. Every string must sit inside a `<Text>`: a bare string in a `<View>` is an error, not an anonymous text node (artikel 03)                                                                                                                                |
| Styling           | Tailwind v4 classes compiled to CSS; the cascade, inheritance, media queries, units like `rem`                                             | JavaScript objects (`StyleSheet.create`), no cascade and no inheritance (except text inside text), numbers are density-independent pixels; Flexbox is the only layout and `flexDirection` defaults to `column` (artikel 04). NativeWind brings `className` back (artikel 05)                                                                                 |
| Lists             | `.map()` over an array; the browser handles thousands of rows                                                                              | `FlatList`/`FlashList` render only what is on screen, because every row is a real native view in memory (artikel 06 and 07)                                                                                                                                                                                                                                  |
| Navigation        | The URL is the state: React Router (`apps/admin/src/app/routes.tsx`) or Next's App Router (`apps/web/src/app/`), the browser's back button | A stack of screens that slide in and out, tabs, modals, the system back gesture. Expo Router is file-based like Next's App Router (`app/(tabs)/index.tsx` is `/`), and `goshop://…` links map onto routes (artikel 08 and 09)                                                                                                                                |
| Screen edges      | The page scrolls inside a browser window                                                                                                   | Notches, the status bar, the home indicator and the keyboard cover parts of the screen; safe-area insets and keyboard avoidance are the app's job (artikel 10)                                                                                                                                                                                               |
| Session storage   | The refresh token in an `HttpOnly` cookie no script can read, the access token in memory (ADR 0008, `packages/shared/src/api/auth.ts`)     | No cookie jar we control and no `HttpOnly`: the token pair from `POST /v1/auth/login` goes into the platform keystore through `expo-secure-store` (Keychain on iOS, Keystore-backed storage on Android), never AsyncStorage                                                                                                                                  |
| Networking        | `fetch`, subject to CORS: the API lists the browser origins it allows (`APP_CORS_ALLOWED_ORIGINS`)                                         | The same `fetch` API, but Expo installs its own implementation (`expo/fetch`), which sends and stores cookies unless told otherwise, so the app's API client passes `credentials: "omit"` (artikel 12). CORS is a browser rule, so a native app is not subject to it. `localhost` is the device itself, so an emulator needs the host's address (artikel 02) |
| Fonts and icons   | `@font-face`, SVG inline in JSX (`lucide-react`)                                                                                           | Fonts are loaded into the app (`expo-font`) before text that uses them renders; icons come from an icon font or `react-native-svg` (artikel 11)                                                                                                                                                                                                              |
| Accessibility     | Semantic HTML plus `aria-*`                                                                                                                | `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, mapped to TalkBack and VoiceOver                                                                                                                                                                                                                                                            |
| Dev loop          | Vite or Next dev server, hot module replacement, browser DevTools                                                                          | Metro bundler, Fast Refresh on the device, React Native DevTools (artikel 13)                                                                                                                                                                                                                                                                                |
| Build and release | `pnpm build` → a Docker image (`apps/*/Dockerfile`) → Railway                                                                              | `eas build` → an `.apk`/`.aab` for Android and an `.ipa` (or a simulator build) for iOS → the stores. No Dockerfile, no Railway service: the app is not a container                                                                                                                                                                                          |

### What is shared, and what is not

**Shared** (artikel 12): React itself, TypeScript, TanStack Query, Zustand, React Hook Form with Zod, and everything in `packages/shared` that is plain TypeScript: the generated API types, the API client with its retries (`createApiClient`), `ApiError`, the Zod schemas, `formatRupiah`. Validation written once runs in the browser, on the phone, and mirrors the rules the Go API enforces.

**Not shared**: components (a `<button>` cannot render on a phone, a `<Pressable>` cannot render in a browser), styling, routing, and the session. The web session's cookie flow (`webLogin`, `webRefresh`, `X-GoShop-Client`) exists because a browser must keep the refresh token away from scripts; a phone has a keystore instead, so the app uses the plain `login` and keeps the tokens in `expo-secure-store`.

### Decisions

- **React Native through Expo, not the bare React Native CLI.** Expo is a set of tools around React Native: native modules with one JavaScript API for both platforms (`expo-secure-store`, `expo-font`, `expo-image` …), a CLI and bundler setup, file-based routing (Expo Router), and EAS, the build service that produces store binaries without each reader configuring Xcode signing and Gradle by hand. React Native's own documentation recommends starting new apps with a framework, and Expo is the one it names. Nothing is hidden: `npx expo prebuild` writes the full Android and iOS projects at any time (artikel 02).
- **No web target.** React Native can render to the browser too (`react-native-web`), but GoShop already has a storefront built for the web (SEO, server rendering, Bab 11). `app.config.ts` sets `platforms: ["android", "ios"]`.

## Setup Expo, Expo Go dan emulator Android (artikel 02)

`apps/mobile` is a workspace package, `@goshop/mobile`, with one screen ("GoShop") and everything around it: the app's identity, its build profiles, the bundler setup in this pnpm monorepo, and lint and type checks that `make build lint` runs with the other apps.

### The mental model

| Idea                                   | What it means                                                                                                                                                                                                                   | Go comparison                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Metro**                              | The bundler: it serves the JavaScript to the app during development (Fast Refresh on save) and writes the final bundle for a release. Vite's job, for a phone                                                                   | `go build` for the JavaScript half                                                            |
| **Two halves of an app**               | The native half (the `.apk` or `.app`: Java/Kotlin/Swift, every native module compiled in) and the JavaScript half (your code, from Metro). Changing JavaScript needs a reload; adding a native module needs a new native build | A binary and a config/plugin it loads: one is rebuilt rarely, the other changes on every save |
| **Expo Go**                            | A ready-made native half from the app stores, with a fixed set of Expo modules compiled in. Scan a QR code and it runs your JavaScript. Nothing to build, but only the modules it contains, and only for its own SDK version    | A prebuilt interpreter: fast to start, limited to what was linked into it                     |
| **Development build**                  | Your own native half, with exactly the modules this app uses, plus `expo-dev-client` (a launcher that connects to Metro). Built once with `npx expo run:android` or `eas build --profile development`, then used like Expo Go   | Your own binary built with the packages you import                                            |
| **Continuous Native Generation (CNG)** | `android/` and `ios/` are generated from `app.config.ts` and config plugins by `npx expo prebuild`, so they are build output and gitignored. A native setting lives in the config, never in a hand-edited Gradle or Xcode file  | Generated code (`sqlc`, `openapi-typescript`): you change the input and regenerate            |
| **EAS Build**                          | Expo's build service: runs prebuild and the native build on its machines (or yours with `--local`) for one profile in `eas.json`. It is this app's "deploy"                                                                     | The CI job that turns a tag into release artefacts                                            |

### Decisions

- **Expo SDK 58**: `expo` 58.0.21, React Native 0.88.1 (Hermes, the New Architecture), Expo Router 58.0.28. Every Expo and React Native package is pinned to the exact version `npx expo install` chose for SDK 58; add packages with `npx expo install <name>` from this folder, never `pnpm add`, so they match the SDK.
- **React 19.3.0 here, 19.3.1 in the catalog.** React Native ships its own renderer built against one exact React version and refuses to run with another, so the app pins what React Native 0.88.1 expects instead of the workspace catalog's `react`. `react-dom` is pinned to the same 19.3.0: Expo's web tooling declares it as a peer, and without the pin pnpm would install the catalog's 19.3.1 next to React 19.3.0. Each workspace package resolves its own React, so the web apps keep theirs.
- **TypeScript from the catalog (5.9.3).** Expo SDK 58 recommends TypeScript ~6.0.3; the repository pins one TypeScript for every package. `package.json` therefore lists `typescript` under `expo.install.exclude`, which tells `expo install --check` and `expo-doctor` that the difference is deliberate. When the catalog moves to TypeScript 6, the exclusion goes.
- **Routes in `app/`, everything else in `src/`.** Expo Router reads `app/` (or `src/app/`, the default of the newest template). The routes stay at the top so a route file is never mistaken for a component, and `src/` is organised by feature (`src/features/<feature>/{components,hooks,api}`) as the app grows. Route files stay thin.
- **`app.config.ts`, not `app.json`**, because it can read the environment: a `production` EAS build stops at once when `EXPO_PUBLIC_API_URL` is missing, the way the dashboard's production build refuses to run without `VITE_API_URL`. Name `GoShop`, slug `goshop`, scheme `goshop` (deep links, artikel 08), and the one identifier `com.santekno.goshop` as both `android.package` and `ios.bundleIdentifier`.
- **The API URL is read in one place**, `src/config/env.ts`: `EXPO_PUBLIC_API_URL`, trimmed of a trailing slash, or the local API as each simulator sees it. Expo only inlines the literal `process.env.EXPO_PUBLIC_API_URL`, which is another reason not to scatter reads around the code.
- **Metro needs no monorepo settings.** Since SDK 52, `expo/metro-config` detects the workspace: it watches the repository root (a change in `packages/shared` reloads the app) and follows pnpm's symlinked `node_modules`, so pnpm's default isolated layout works without `node-linker=hoisted`. `metro.config.js` is the default config, kept as the place NativeWind wraps in artikel 05. Checked: a temporary import of `formatRupiah` and `loginSchema` from `@goshop/shared` bundled for both platforms, type-checked and linted; the real import arrives with the catalog (artikel 06) and code sharing (artikel 12).
- **`allowImportingTsExtensions`** in `tsconfig.json`: `packages/shared` names its imports `./api/url.ts` (Node runs it by stripping types), and `tsc` follows `@goshop/shared` into those files.
- **ESLint like the dashboard, without `eslint-config-expo`.** The repository is on ESLint 10; `eslint-config-expo` depends on `eslint-plugin-react` and `eslint-plugin-import`, whose peer ranges stop at ESLint 9. The app uses the same type-aware `typescript-eslint` presets and React Hooks rules as `apps/admin`, and Prettier from the catalog. The config is `eslint.config.mjs` because this package is CommonJS (Metro loads `metro.config.js` with `require`).
- **`pnpm build` is `expo export`.** `make build` runs every workspace's `build`. For this app that is the JavaScript bundle for Android and iOS (`dist/`, gitignored, about 15 seconds): it resolves every import the way the phone will, catches a module Metro cannot find, which `tsc` does not, and needs no Android SDK, Xcode or Expo account. The native binaries are not part of `make build`: they need platform SDKs and signing, and come from EAS.
- **`expo-dev-client` from the start**, because `eas.json`'s `development` profile builds a development client. With it installed, `pnpm start` targets a development build; `pnpm start:go` opens the same project in Expo Go.
- **No unit tests yet.** `test:unit` only says so, which keeps `make test-unit` green; the test setup belongs to the test stage.

### Installing what you need

| For                   | Install                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Everything            | Node.js 24 and pnpm 10 (`corepack enable`), then `pnpm install` at the repository root                                                                                         |
| Expo Go on your phone | The Expo Go app from Google Play or the App Store, for SDK 58. The phone and the computer on the same network                                                                  |
| The Android emulator  | Android Studio (SDK, platform tools, an emulator image), `ANDROID_HOME=~/Library/Android/sdk` on macOS, a JDK for Gradle, and a virtual device from Device Manager             |
| The iOS simulator     | macOS with Xcode and its simulators, and CocoaPods for `prebuild`. Not needed for Android, and not possible on Windows or Linux: an EAS cloud build produces the iOS app there |

### Three ways to run it

1. **Expo Go**, nothing to build: `pnpm --filter @goshop/mobile start:go`, then scan the QR code with the phone's camera (iOS) or the Expo Go app (Android). Good for the first chapters; it stops being enough when the app adds a native module that Expo Go does not contain.
2. **A development build on the emulator**: start a virtual device, then `pnpm --filter @goshop/mobile android`. That runs `npx expo run:android`: prebuild, Gradle, install, launch, and Metro for Fast Refresh. The first build takes several minutes; later ones reuse Gradle's cache. `pnpm --filter @goshop/mobile ios` does the same for the iOS simulator on a Mac.
3. **A preview build**, the app as a tester gets it, with the JavaScript bundled inside and no Metro: `eas build --profile preview --platform android` (an `.apk` to install with `adb install` or by opening it on a phone) or `--platform ios` (a simulator build).

### Reaching the API from a device

The API listens on port 8080 of your computer. Who "localhost" is depends on where the app runs:

| Where the app runs           | The API URL                                                               | Why                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Android emulator             | `http://10.0.2.2:8080` (the default)                                      | The emulator is a virtual device with its own network; `10.0.2.2` is its alias for the host |
| iOS simulator                | `http://localhost:8080` (the default)                                     | The simulator shares the Mac's network                                                      |
| A phone (Expo Go or a build) | `http://<your computer's LAN address>:8080`, set in `EXPO_PUBLIC_API_URL` | The phone is another machine on the Wi-Fi                                                   |
| A store build                | The public HTTPS API, set as an EAS environment variable                  | The `production` profile refuses to build without one                                       |

Set it in `apps/mobile/.env.local` (copy `.env.example`); Expo reads `.env` files when Metro starts, so restart `pnpm start` after a change. A value is baked into the bundle: never put a secret in an `EXPO_PUBLIC_` variable. The API's CORS list does not matter here, because CORS is enforced by browsers, not by native apps.

One limit to know before the first API call: Android blocks plain `http://` in release builds (its cleartext-traffic policy). A development build allows it, so `pnpm android` reaches `http://10.0.2.2:8080`; a `preview` or `production` APK does not. Artikel 06, the first screen that calls the API, settles how a preview build reaches a local API.

### EAS build profiles

`eas.json` has one profile per audience. Each builds both platforms, from the same `app.config.ts`:

| Profile       | Android                  | iOS                         | For                                                                                         |
| ------------- | ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------- |
| `development` | development client (APK) | development client (device) | The developer: your own native half with the dev launcher, JavaScript from Metro            |
| `preview`     | `.apk`                   | simulator build (`.app`)    | Testers and this course: installs directly on an emulator, a phone or a simulator, no store |
| `production`  | `.aab` (App Bundle)      | archive (`.ipa`)            | The stores: Google Play only accepts App Bundles; the App Store an archive signed for it    |

`appVersionSource: "remote"` lets EAS keep the build numbers (`versionCode`, `buildNumber`), and `autoIncrement` raises them on every production build, because both stores reject a second upload with the same number. EAS needs an Expo account and a project: `eas login`, then `eas init` once, which writes the project's ID into the config.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                         | Where to read it                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| The app's identity, platforms, plugins          | `app.config.ts`                                                                    |
| Build profiles                                  | `eas.json`                                                                         |
| The API URL                                     | `src/config/env.ts`, `.env.example`                                                |
| The routes: the root stack and the first screen | `app/_layout.tsx`, `app/(tabs)/index.tsx` (moved into the tab group in artikel 08) |
| Bundler, types, lint                            | `metro.config.js`, `tsconfig.json`, `src/expo-types.d.ts`, `eslint.config.mjs`     |
| What is generated and never committed           | `.gitignore` (`android/`, `ios/`, `.expo/`, `dist/`)                               |

## Komponen inti: View, Text, Image dan Pressable (artikel 03)

The home screen shows product cards: `ProductCard`, the phone's version of `apps/web`'s card (photo, name, price, "Stok habis"), built from React Native's four core components. The products are six samples in the exact shape `GET /v1/products` returns, until artikel 06 fetches the real catalog.

### The mental model

| Web                                  | React Native                                                   | What changes                                                                                                                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<div>`                              | `View`                                                         | A box that lays out its children and draws a background or a border. It cannot hold a string                                                                                                                                                                         |
| `<p>`, `<span>`, `<h3>`, a text node | `Text`                                                         | The only component a string may sit in: `<View>Rp 89.000</View>` is a runtime error, not an anonymous text node. Nested `Text` inherits the outer one's style, the one place anything is inherited                                                                   |
| `<img src srcset alt>`               | `Image` with `source`                                          | A remote image has **no intrinsic size**: React Native does not download it to measure it, so without a width and a height in its style it is drawn 0 × 0. `source` can be a list of sizes, and the native side picks the smallest that fills the box (the `srcset`) |
| `<button onClick>`, `:active`        | `Pressable` with `onPress` and `style={({ pressed }) …}`       | No click and no built-in look: `Pressable` reports the touch and whether a finger is down; the app draws the feedback                                                                                                                                                |
| `aria-label`, the button's role      | `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` | Read by TalkBack (Android) and VoiceOver (iOS). A `Pressable` with a label is **one** element: the screen reader announces the label, not each `Text` inside                                                                                                         |
| `line-clamp-2`                       | `<Text numberOfLines={2}>`                                     | A property of the text, not a style                                                                                                                                                                                                                                  |

### Decisions

- **The card takes the API's `Product`, from `@goshop/shared`.** The catalog response (`ProductList.data`) is a list of full `Product`s; the contract has no separate summary type. The app now depends on `@goshop/shared` (`workspace:*`, like the web apps) and imports the `Product` type and `formatRupiah`; artikel 12 covers what else is shared and why. `formatRupiah` uses `Intl.NumberFormat("id-ID")`, which Hermes provides on both platforms.
- **One price, or "Mulai".** As on the web, `price_from` is the cheapest variant; the card says "Mulai Rp 89.000" when another variant costs more.
- **The photo uses every variant.** `ProductPhoto` passes the API's `variants` (400 and 800 pixels) as a list of `{ uri, width, height }`; once the box is laid out, the platform picks the smallest that is sharp enough at the screen's density, the job `srcset` + `sizes` do in `apps/web`. A product without a photo gets the same "Belum ada foto" placeholder as the storefront.
- **The accessible label is built, not read off the screen.** `"Kopi Arabika Gayo 250 g, mulai Rp 89.000"`, plus `"stok habis"` when nothing is in stock, and the hint "Membuka halaman produk". The photo carries no label of its own, so it is not read twice.
- **`onPress` is a prop, the card does not navigate.** The screen decides what a tap does: for now an `Alert`, because the product route arrives in artikel 08. Like the web card, it is wrapped in `memo`.
- **Sample photos from picsum.photos.** The API's image storage (`http://localhost:8333`) is neither running without `make up` nor reachable from a phone at that address, so the samples point at a public placeholder service with the same two widths the worker writes. `fixtures.ts` goes when artikel 06 loads the catalog.
- **A `ScrollView` for now.** Six cards taller than the screen must scroll, and a `View` does not. A `ScrollView` renders all of its children at once, fine for six; artikel 06 and 07 move to a list that renders only what is on screen.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                 | Where to read it                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The card: core components, pressed state, accessibility | `src/features/catalog/components/ProductCard.tsx`                                                                      |
| The photo: variants as a source list, the placeholder   | `src/features/catalog/components/ProductPhoto.tsx`                                                                     |
| The sample products, in the API's shape                 | replaced by the API in artikel 06; the last version: `git show d2daf2c3:apps/mobile/src/features/catalog/fixtures.ts`  |
| The screen that lists them and decides what a tap does  | `app/(tabs)/index.tsx`; since artikel 06 the list and the tap are in `src/features/catalog/components/ProductList.tsx` |

## Styling dengan StyleSheet dan flexbox (artikel 04)

The cards now look like the storefront's: a bordered panel with a square photo, laid out two per row. Everything is styled with `StyleSheet.create` and flexbox, React Native's own styling, before NativeWind brings class names back in artikel 05.

### The mental model

A style in React Native is a JavaScript object passed to one component's `style` prop. It looks like CSS written in camelCase, but most of what makes CSS _CSS_ is missing:

| CSS on the web (`apps/web`)                                              | `StyleSheet` in React Native                                                                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selectors and the cascade: a rule matches many elements, later rules win | No selectors. A style applies to the component it is passed to, nothing else. Composition is an array: `style={[styles.card, pressed && styles.cardPressed]}`, the last entry wins      |
| Inheritance: `color` and `font-*` flow down to every descendant          | None, except `Text` nested in `Text`. Each `Text` sets its own colour and size; a `View` has no font at all                                                                             |
| Units: `px`, `rem`, `%`, `vw`, `calc()`                                  | Unitless numbers in density-independent pixels (dp on Android, points on iOS), and percentages. No `rem` (nothing scales with a parent's font size), no `calc()`: compute in JavaScript |
| `display: block`, inline flow, floats, CSS Grid                          | Flexbox only (Yoga), on every `View`. No grid: a wrapping row is the grid                                                                                                               |
| `flex-direction: row` by default                                         | `flexDirection: "column"` by default: children stack top to bottom, so `justifyContent` is vertical and `alignItems` horizontal                                                         |
| `flex: 1` is shorthand for `1 1 0%`                                      | `flex: 1` means "take the free space along the main axis"; negative or shorthand forms do not exist                                                                                     |
| `aspect-ratio: 1`, `object-fit: cover`                                   | `aspectRatio: 1` on the box, `resizeMode="cover"` on the `Image`                                                                                                                        |
| `:hover`, `:active`, `@media (prefers-color-scheme: dark)`               | No pseudo-classes and no media queries: the pressed state comes from `Pressable` (`({ pressed }) => …`), the screen size from `useWindowDimensions`, the theme from `useColorScheme`    |

`StyleSheet.create` itself is an identity function today: it type-checks the object (a typo in a property name fails `tsc`) and keeps all of a component's styles at the bottom of its file, under names that say what they style.

### Decisions

- **The grid is a wrapping row with exact widths.** `ProductGrid` is `flexDirection: "row"`, `flexWrap: "wrap"` and `gap: 12`, with 16 dp of padding. Each cell's width is computed from `useWindowDimensions()`: `(screen − 2 × padding − gaps) / columns`. `width: "50%"` does not work, because the gap is added on top of the two halves and the second card wraps. Two columns on a phone; a screen with room for more cards of at least 160 dp gets more. The cell owns the width, so `ProductCard` does not know how many columns there are.
- **Cards in a row are the same height.** A wrapping row stretches each item to the tallest in its line (`alignItems: "stretch"`, the default), and the card has `flex: 1` to fill its cell, the job `flex` on the web grid's `<li>` does.
- **The photo is `width: "100%"` and `aspectRatio: 1`**: as wide as the card, as tall as it is wide, cropped with `resizeMode="cover"`, with the muted colour drawn underneath while it downloads.
- **Colours are the storefront's tokens, light only.** The values come from `apps/web/src/index.css` (`--card`, `--border`, `--muted-foreground`, `--destructive` …) and sit in one `colors` object above the styles. A `StyleSheet` cannot read a CSS variable or a media query, so dark mode would mean a second set picked with `useColorScheme()` in every component; artikel 05 does it with NativeWind instead.
- **The width depends on the screen, so it is an inline style.** `StyleSheet.create` runs once, when the module loads; a value computed during render (`{ width: cellWidth }`) goes straight into `style`.

The card's styles, for comparison with the `className` version in artikel 05:

```tsx
const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 4,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  cardPressed: { backgroundColor: colors.cardPressed },
  name: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: colors.foreground,
  },
  price: { fontSize: 16, fontWeight: "600", color: colors.foreground },
  priceFrom: { fontWeight: "400", color: colors.mutedForeground },
  soldOut: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.destructive,
  },
  soldOutText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.destructiveForeground,
  },
});
```

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                              | Where to read it                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The grid: a wrapping row, `gap`, cell widths from the screen's width | replaced by `FlatList`'s columns in artikel 06; the last version: `git show d2daf2c3:apps/mobile/src/features/catalog/components/ProductGrid.tsx` |
| The card's panel, text styles, pressed style, badge                  | `src/features/catalog/components/ProductCard.tsx`                                                                                                 |
| The square photo: `width: "100%"`, `aspectRatio`, `resizeMode`       | `src/features/catalog/components/ProductPhoto.tsx`                                                                                                |
| The screen's background and scrolling                                | `app/(tabs)/index.tsx`; the scrolling list since artikel 06: `src/features/catalog/components/ProductList.tsx`                                    |

## NativeWind: Tailwind di React Native (artikel 05)

The card, its photo and the home screen are now styled with `className`, the same Tailwind classes the storefront uses (`rounded-lg border bg-card p-3`), and they follow the device into dark mode. NativeWind compiles the classes into React Native style objects when the app is built; at run time a `className` becomes the same `style` a `StyleSheet` would have produced.

### The mental model

| Piece                 | What it does                                                                                                                                                                                                                                 | On the web                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `tailwind.config.js`  | Which files to scan (`content`), NativeWind's preset, the theme: GoShop's colour roles from `src/theme/colors.js`                                                                                                                            | `@theme` in `apps/web/src/index.css` (Tailwind v4 is configured in CSS) |
| `global.css`          | Tailwind's three layers, the input Tailwind generates CSS from. Imported once, in `app/_layout.tsx`                                                                                                                                          | `src/index.css`, imported by the root layout                            |
| `metro.config.js`     | `withNativeWind` runs Tailwind on `global.css` for each platform and turns the CSS into a table of style objects (`bg-card` → `{ backgroundColor: "#ffffff" }`) that ships inside the JavaScript bundle. There is no CSS engine on the phone | The PostCSS/Vite plugin that writes a `.css` file the browser applies   |
| `babel.config.js`     | `jsxImportSource: "nativewind"`: every JSX element goes through NativeWind's JSX runtime, which looks the `className` up in that table and passes `style` to the core component                                                              | Nothing: `className` is an HTML attribute                               |
| `nativewind-env.d.ts` | Adds `className` to the types of `View`, `Text`, `Image`, `Pressable`, `ScrollView` …                                                                                                                                                        | Built into React's DOM types                                            |
| `dark:`               | A `prefers-color-scheme: dark` condition kept in the table and checked against the device's appearance (`darkMode: "media"`); switching the phone's theme re-renders with the other values, no restart                                       | A media query (or `data-theme`, the storefront's toggle)                |
| `active:`             | The pressed state: NativeWind listens to the `Pressable`'s press-in and press-out                                                                                                                                                            | `:active`                                                               |
| `inlineRem: 16`       | How many dp `1rem` is. NativeWind's default is 14; 16 makes `p-3` 12 dp and `text-sm` 14 dp, as on the web                                                                                                                                   | The browser's 16 px root font size                                      |

### Is NativeWind 4 compatible with Expo SDK 58?

NativeWind 4.2.7 (14 September 2026) is the newest 4.x; its Expo guide names SDK 57 as the newest SDK it was released for, and Expo SDK 58 came out two weeks later. Its peer ranges do not exclude this app: `react-native-css-interop` 0.2.7 asks for `react-native` `*`, `react` `>=18`, `react-native-reanimated` `>=3.6.2` and `tailwindcss` `~3`. Checked on this app (React Native 0.88.1, Expo 58.0.21):

- `pnpm build` (`expo export`, Android and iOS) bundles; `npx expo prebuild --platform all --clean` and `npx expo-doctor` (20/20) pass.
- In an unminified Android bundle, `global.css` became one `injectData({...})` call with `rem: 16`, `darkMode: "media"`, `"p-3": { padding: 12 }`, `"bg-card": { backgroundColor: "#ffffff" }`, `"dark:bg-card-dark"` under a `prefers-color-scheme: dark` condition and `"active:bg-accent"` with `pseudoClasses: { active: true }`. `ProductCard` compiles to `jsxs(Pressable, { className: "flex-1 gap-1 …" })` through `react-native-css-interop`'s JSX runtime: the transform is in place.
- Still to see on a device: the cards drawn, the pressed colour, and the switch to dark mode on Android and iOS.

NativeWind 5 (Tailwind v4, the same major as the web apps) is only a release candidate (`5.0.0-rc.0`), so the course stays on 4.

### Decisions

- **Pinned versions.** `nativewind` 4.2.7 and `react-native-css-interop` 0.2.7 (the version nativewind itself depends on), `tailwindcss` 3.4.19, and, from `npx expo install` for SDK 58, `react-native-reanimated` 4.7.1, `react-native-worklets` 0.13.0 (Reanimated 4's worklet runtime), `babel-preset-expo` 58.0.22 and `expo-system-ui` 58.0.7.
- **Tailwind v3 in this app, v4 everywhere else.** NativeWind 4 is built on Tailwind v3 (`tailwindcss ~3` peer), so `package.json` pins `tailwindcss` 3.4.19 directly instead of the workspace catalog's 4.3.3. Each workspace package resolves its own: the web apps keep v4. The classes used here mean the same in both; what differs is where the theme is written (`tailwind.config.js` here, `@theme` in CSS there).
- **`react-native-css-interop` is a direct dependency.** `nativewind/babel` rewrites every file's JSX to import `react-native-css-interop/jsx-runtime`. With pnpm's isolated `node_modules`, a package that is only a dependency of `nativewind` cannot be resolved from the app, and the build failed with `Unable to resolve module react-native-css-interop/jsx-runtime from app/_layout.tsx`. Listing it at the exact version `nativewind` uses resolves it to the same single copy, without switching the repository to `node-linker=hoisted`.
- **`@babel/plugin-transform-react-jsx` is a direct dev dependency, for the same reason.** `react-native-css-interop`'s Babel preset names that plugin without depending on it. `pnpm build`, `pnpm start` and `npx expo …` still found it, because pnpm's command shims put `node_modules/.pnpm/node_modules` on `NODE_PATH`; a native release build does not go through a shim: Gradle (and Xcode's bundle phase, and so EAS Build) runs `node …/@expo/cli export:embed` directly, and every release build since this article stopped with `Cannot find module '@babel/plugin-transform-react-jsx'`. Found in the chapter's native check (a `preview` APK); listed at 7.29.7, the version already in the lockfile.
- **Reanimated comes with it.** NativeWind's runtime uses Reanimated for `transition-*` and `animate-*` classes, and `react-native-css-interop` declares it as a peer. It is a native module, so this is the first change since artikel 02 that needs a new development build (Expo Go already contains it). `babel-preset-expo` adds the worklets Babel plugin by itself when `react-native-worklets` is installed, so `babel.config.js` lists only NativeWind's additions.
- **Colours are the storefront's roles, with an explicit `dark:` twin.** `src/theme/colors.js` holds each role from `apps/web/src/index.css` (`background`, `card`, `primary`, `muted-foreground`, `destructive`, `border` …) with its light (`DEFAULT`) and dark value, so `bg-card` and `dark:bg-card-dark` are both generated. The web swaps CSS variables on `:root`, so its components never write `dark:`; here every colour class carries its `dark:` partner, which is longer to write but readable in place and needs nothing beyond the documented `darkMode: "media"`.
- **One colour file for classes and for code.** `src/theme/colors.js` is plain CommonJS because `tailwind.config.js` runs in Node and requires it; TypeScript reads it too (`allowJs` in Expo's base config). The navigation theme (`src/theme/navigation.ts`) uses it: Expo Router paints the header and the screen behind the content itself, in a light theme unless given one, so `app/_layout.tsx` wraps the stack in `<ThemeProvider>` with GoShop's colours for the current scheme.
- **`expo-system-ui`**, because `app.config.ts`'s `userInterfaceStyle: "automatic"` is only applied on Android with it installed (`expo prebuild` warned until it was), and it keeps the window behind the app in the right colour.
- **Restyled, not duplicated.** There is one `ProductCard`, now with `className`; the `StyleSheet` version stays in the artikel 04 section of this README, and the two side by side are below. `ProductGrid` stays a `StyleSheet` on purpose: its cell width is a number computed during render, which no class can express, and mixing `style` and `className` is normal. (Artikel 06 replaced the grid with `FlatList`'s columns, whose cells are `w-1/2` classes.)
- **Class names are written out in full.** Tailwind scans the files as text (`content`) and generates only the class names it finds. `"bg-" + role` is never generated; `ProductPhoto` keeps its shared classes in one constant string instead. Words in comments that happen to be class names (`grid`, `filter`) get generated too; they are unused and harmless.
- **No `prettier-plugin-tailwindcss`.** NativeWind's guide suggests it to sort class names; no other app in the repository sorts them, so neither does this one.

### StyleSheet and className, side by side

```tsx
// Artikel 04: StyleSheet (colours from a constant, light only)
<Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
//   card: { flex: 1, gap: 4, padding: 12, borderRadius: 8, borderWidth: 1,
//           borderColor: colors.border, backgroundColor: colors.card }

// Artikel 05: NativeWind (the storefront's classes, dark mode included;
// `grow`, not `flex-1`, since artikel 06: see its decisions)
<Pressable className="grow gap-1 rounded-lg border border-border bg-card p-3 active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark">
```

Both end as the same style object on the native view. `StyleSheet` needs nothing installed and is checked by `tsc` property by property; `className` is shorter, shares its vocabulary with `apps/web`, and has the pressed and dark states built in, at the cost of a build step and a few dependencies.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                             | Where to read it                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind's configuration: files scanned, preset, colours, dark mode | `tailwind.config.js`                                                                                                               |
| GoShop's colour roles, light and dark                               | `src/theme/colors.js`                                                                                                              |
| NativeWind in the build: Metro, Babel, the input CSS, the types     | `metro.config.js`, `babel.config.js`, `global.css`, `nativewind-env.d.ts`                                                          |
| The CSS imported once; the navigation's colours per scheme          | `app/_layout.tsx`, `src/theme/navigation.ts`                                                                                       |
| The card, photo and screen with `className`                         | `src/features/catalog/components/ProductCard.tsx`, `src/features/catalog/components/ProductPhoto.tsx`, `app/(tabs)/index.tsx`      |
| The one `StyleSheet` kept beside NativeWind                         | `ProductGrid`, until artikel 06; the last version: `git show d2daf2c3:apps/mobile/src/features/catalog/components/ProductGrid.tsx` |

## FlatList untuk daftar produk (artikel 06)

Beranda now shows the real catalog: `GET /v1/products` through the shared API client, twenty products per page, two cards per row, the next page loaded as the buyer nears the end, pull-to-refresh, and a loading, empty and error state for each moment. The search field and the sort sheet put `q` and `urut` in the route (artikel 09 and 10), and the Kategori tab (artikel 14) puts a category slug in `kategori`; the list reads all three and asks the API with them. The six sample products are gone.

### The mental model

| Idea                                  | What it means on the phone                                                                                                                                                                                                                                                                                                                             | On the web (`apps/web`)                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **A list renders a window**           | `ScrollView` mounts every child at once and keeps it; each card is a real native view with a decoded photo in memory. `FlatList` (a `VirtualizedList`) mounts the rows near the screen (`windowSize`, about ten screens' worth) and stands in for the rest with blank space of the measured height, so memory stays flat however far the buyer scrolls | The browser keeps every `<li>`; thousands are fine                                        |
| **`numColumns` makes the grid**       | `FlatList` groups the items into rows of two, one `View` with `flexDirection: "row"` per row. Each cell is `w-1/2 p-1.5`; the list's `px-2.5` adds up to 16 dp at the edges and 12 dp between cards                                                                                                                                                    | `grid grid-cols-2 gap-3`                                                                  |
| **`onEndReached` is the sentinel**    | `FlatList` calls it when the end of the content is `onEndReachedThreshold` screen-heights away (here one). It can fire more than once, so the screen checks `hasNextPage && !isFetching && !isFetchNextPageError` before `fetchNextPage()`                                                                                                             | An `IntersectionObserver` on a div after the grid (`useOnVisible` in `ProductListFooter`) |
| **The header, the footer, the empty** | `ListHeaderComponent` scrolls with the rows (the caption), `ListFooterComponent` sits after the last row (next-page spinner, retry, "Semua produk sudah ditampilkan."), `ListEmptyComponent` replaces the rows while there are none (first load, offline, error, no match)                                                                             | Elements before and after the `<ul>`                                                      |
| **Pull-to-refresh is native**         | `refreshControl={<RefreshControl …/>}`: Android's circle drops from the top, iOS's spinner opens above the list. It takes colours as props, not a style                                                                                                                                                                                                | Nothing: a page reload                                                                    |
| **Server state lives in the cache**   | TanStack Query 5.104.5, the version in the workspace catalog that `apps/web` and `apps/admin` use. `useInfiniteQuery` keeps every page per query key (`["products", "list", { category, q, sort }]`); the screen holds no list state of its own                                                                                                        | The same `infiniteQueryOptions` shape (`features/catalog/api/queries.ts`)                 |
| **Focus and online must be wired**    | A browser tells TanStack Query about `visibilitychange` and `online`/`offline` by itself. React Native has neither event, so `src/lib/query-client.ts` connects `AppState` to `focusManager` (back to the app → stale queries refetch) and `expo-network` to `onlineManager` (no network → queries pause, then run when it returns)                    | Built in                                                                                  |

### From the route to the request

| Route (`/?q=…&urut=…`)                       | `readCatalogFilters` (`src/features/catalog/catalog-filters.ts`) | `GET /v1/products?…`                       |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `/`                                          | `{ sort: "newest" }`                                             | `limit=20&sort=newest`                     |
| `/?urut=termurah`                            | `{ sort: "price_asc" }`                                          | `limit=20&sort=price_asc`                  |
| `/?q=%20kaos%20&urut=termahal`               | `{ q: "kaos", sort: "price_desc" }`                              | `limit=20&q=kaos&sort=price_desc`          |
| `/?kategori=kaos&urut=termurah`              | `{ category: "kaos", sort: "price_asc" }`                        | `limit=20&category=kaos&sort=price_asc`    |
| `/?kategori=Kaos%20Polos` (not a slug)       | `{ sort: "newest" }`                                             | `limit=20&sort=newest`                     |
| `/?urut=apa-saja`, `/?q=` (unknown or empty) | `{ sort: "newest" }`                                             | `limit=20&sort=newest`                     |
| next page                                    | the same filters                                                 | the same, plus `cursor=<page.next_cursor>` |

The words are the storefront's (`terbaru`, `termurah`, `termahal` → `newest`, `price_asc`, `price_desc`, from `sort-options.ts`), and the checks are the web's `readCatalogFilters`: `q` trimmed and cut to 100 code points, an unknown sort word falls back to newest instead of reaching the API as a 400, and `kategori` is sent as `category` only when it matches the contract's slug pattern (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 100 characters). A well-formed slug that names no category still reaches the API, which answers `400 UNKNOWN_CATEGORY`; the list then says "Kategori ini tidak ada." with a "Lihat semua produk" button, rather than a retry that would fail the same way.

The active category shows as a chip above the caption, by its name when the Kategori tab has already loaded the categories (a read of the `["categories"]` cache entry through `categoriesQuery().queryKey`, the query the Kategori tab fetches with; no request of its own) and by its slug otherwise, as after a deep link. Pressing the chip clears it (`router.setParams({ kategori: undefined })`).

### Which state the list shows

| Situation                                             | What the buyer sees                                                               | Decided by                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| First page loading                                    | "Memuat produk…" with the platform spinner, centred                               | `data === undefined`, not failed, not paused |
| No network before the first page                      | "Tidak ada koneksi internet. Produk dimuat begitu koneksi kembali."               | `fetchStatus === "paused"` (`onlineManager`) |
| First page failed                                     | The error in Indonesian, the request ID (selectable, to quote), "Coba lagi"       | `status === "error"` with no data            |
| Loaded, nothing                                       | "Belum ada produk." or, with a search, "Tidak ada produk yang cocok."             | `data` present, `products.length === 0`      |
| Next page loading / failed                            | A spinner, or the error and "Coba lagi", below the last row; the rows above stay  | `isFetchingNextPage`, `isFetchNextPageError` |
| End of the list                                       | "Semua produk sudah ditampilkan."                                                 | `!hasNextPage` with products                 |
| A category slug the API does not know                 | "Kategori ini tidak ada." and "Lihat semua produk"                                | `isApiError(error, "UNKNOWN_CATEGORY")`      |
| A pull or a background refetch failed, rows on screen | The rows stay; the error with "Coba lagi" above them says they may be out of date | `isRefetchError`                             |

### Decisions

- **One list function.** The request is `fetchProductPage` from `src/features/catalog/api/products.ts` (artikel 12). `src/features/catalog/api/queries.ts` only adds the query key and the paging (`initialPageParam: null`, `getNextPageParam` from `page.next_cursor`, with the web's guard against a cursor that repeats). The filters are the key, so a cursor never crosses from one search to another, and a list nobody shows any more is aborted through the `signal`.
- **`QueryClientProvider` sits in `app/_layout.tsx`, around every screen,** not around Beranda: the Kategori tab (artikel 14) and later the cart and the account read the same cache.
- **The sort sheet carries the other filters.** Returning to `/` with `router.dismissTo({ pathname: "/", params })` gives Beranda those params, not the old ones plus the new: React Navigation replaces a route's params unless told to merge. With only `urut` in them, picking an order dropped the search (since artikel 09) and would now drop the category too. Beranda opens `/filter` with `kategori`, `q` and `urut`, and the sheet hands `kategori` and `q` back with the new `urut`; Expo Router leaves out a parameter whose value is `undefined`, so an absent filter stays absent.
- **The web's cache defaults.** `retry: false`, because the API client already retries a GET once where retrying helps (TanStack's three retries on top would make up to eight requests before the error shows), and `staleTime: 30_000`. One `QueryClient` for the app's lifetime, created at module level: unlike the web there is no server render that could share it between buyers.
- **`expo-network`, not `@react-native-community/netinfo`, for `onlineManager`.** Both are in Expo SDK 58's list of supported versions (`expo-network` 58.0.4, netinfo 12.0.1), and TanStack Query's React Native guide shows both. `expo-network` is Expo's own module, released with each SDK (installed by `npx expo install`, nothing to align by hand), included in Expo Go, and its `addNetworkStateListener` is all `onlineManager` needs. NetInfo's extras (Wi-Fi details, its own reachability pings to a Google URL) are not used. The app reads `isConnected`, not `isInternetReachable`: on Android "reachable" needs a validated internet connection, and an API on the local network (`10.0.2.2`, a laptop on the same Wi-Fi) works without one. `expo-network` adds `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE` to the Android manifest through its library manifest (merged by Gradle); iOS needs no permission. It is a native module, so a development build made before this article must be rebuilt. The listener reports **changes** only, so `src/lib/query-client.ts` also asks once with `getNetworkStateAsync()` when the manager starts: without it a phone already offline when the app opened looked online to TanStack Query, the first page failed with "Tidak dapat terhubung ke server GoShop" instead of waiting, and turning the network on reloaded nothing (found with airplane mode on before launch, in the chapter's native check).
- **Focus is `AppState === "active"`.** "inactive" (iOS app switcher, an incoming call banner) and "background" both count as unfocused; coming back refetches stale queries, the phone's `refetchOnWindowFocus`.
- **Pull-to-refresh refetches the first page only.** `refetch()` on an infinite query refetches every page loaded so far, one after the other, before anything changes on screen: ten requests for a buyer who scrolled ten pages. The buyer is at the top when they pull, so `useProductList().refresh` trims the cached pages to the first and refetches that; later pages load fresh as the buyer scrolls.
- **The refresh spinner shows the pull, not every refetch.** `refreshing={isRefetching}` would drop the spinner from the top every time the buyer returns to the app (a background refetch). `refresh` keeps its own `isRefreshing`, true from the pull until its request ends.
- **The next page waits for the buyer after an error.** `onEndReached` fires again as soon as the list moves; retrying from there would loop against an API that is down. The footer's "Coba lagi" retries that page.
- **`renderItem` and `keyExtractor` live outside the component**, like `openProduct`. A new `renderItem` each render re-renders every visible row, and `memo(ProductCard)` skips a card only when its `product` and `onPress` are the same as before. Unchanged products keep their identity between pages (TanStack Query shares unchanged data structurally).
- **Two columns, fixed.** `numColumns` cannot change on a mounted list without a new `key`, and the app is phone-only (`supportsTablet: false`). The cell is `w-1/2` with padding instead of a `gap`, so the last card of an odd page keeps half the width instead of stretching across the row.
- **The card grows into its cell; it does not start from zero.** Until the chapter's native check the card had `flex-1`, which NativeWind compiles to `flexGrow: 1, flexShrink: 1, flexBasis: "0%"`, as Tailwind's `flex: 1 1 0%`. A basis of zero means "size me from nothing, then grow into the space", and a `FlatList` cell has no height of its own to grow into: its height is its content's. The first page looked right, but when the second page arrived and `FlatList` laid the rows out again, every card shrank to its padding (the release APK showed 68 px tall frames with the photos spilling out of them), the rows collapsed, and the list went blank under the buyer's finger. `grow` (`flexGrow: 1`, basis `auto`) starts from the card's content and still stretches it to the taller card of the row, so the two cards of a row stay the same height. On the web the browser's `min-height: auto` hides the difference; Yoga has no such minimum.
- **NativeWind is the app's styling from here on.** The screen, its top bar and `SearchBar` are written with `className`, every colour from a role in `src/theme/colors.js` with its `dark:` twin. Only numbers measured at run time stay in `style` (the safe-area insets), and colours that a native component takes as props come from the navigation theme (`useTheme()`, the same roles): the text cursor (`selectionColor`) and `RefreshControl`. The icons took theme colours too until artikel 11 gave `Icon` a `className`; they now take classes. `ActivityIndicator` takes a class (`text-primary`), which NativeWind hands to its `color` prop. The search field's grey `PLACEHOLDER_COLOR` became `placeholder:text-muted-foreground dark:placeholder:text-muted-foreground-dark`: NativeWind's `placeholder:` variant moves the colour to `placeholderTextColor`, so the placeholder now follows the theme. Android's own `TextInput` padding is handled with `android:py-1.5`, and the font size is `text-[16px]` rather than `text-base`, which would add a line height that pushes the text off centre on iOS.
- **`ProductGrid` is deleted**, and so is `fixtures.ts`. `FlatList` with `numColumns` lays out the rows now, so the wrapping row with computed cell widths (artikel 04) has no user; its idea, an exact cell width because `gap` is added on top of `"50%"`, is what `w-1/2` with padding avoids here. The artikel 04 and 05 tables above point at its last version in the history of this branch (`git show d2daf2c3:apps/mobile/src/features/catalog/components/ProductGrid.tsx`). The samples were only there until the API was called (artikel 03 said they would go).
- **The error sentences are the storefront's.** `src/lib/error-message.ts` is a copy of `apps/web/src/lib/error-message.ts`, so the same failure reads the same on both. It is plain TypeScript with no host, the kind of code that could move to `packages/shared`; that is the web's package to change, so it is a copy for now.

### Plain `http://` per build profile

A development build talks to `http://10.0.2.2:8080` because Expo's template allows cleartext in the Android **debug** manifest. A `preview` APK is a **release** build: Android 9 and later block `http://` there, so the catalog would fail with `NETWORK_ERROR` against a local API. `app.config.ts` now decides per profile, from `EAS_BUILD_PROFILE` (set by EAS on every build, cloud or `--local`) or `APP_VARIANT` (for a command run by hand, `APP_VARIANT=production npx expo prebuild`); neither set means a developer's machine:

| Profile                     | Android `usesCleartextTraffic` (main manifest, via `expo-build-properties` 58.0.11)  | iOS `NSAppTransportSecurity`                                               |
| --------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `development` (or none set) | `true` (debug builds already allowed it)                                             | Expo's template: no arbitrary loads, `NSAllowsLocalNetworking` `true`      |
| `preview`                   | `true`: the APK reaches `http://10.0.2.2:8080` or a laptop's LAN address             | the same: the simulator build reaches `http://localhost:8080`              |
| `production`                | `false`, written out: with `minSdk` 24, Android 7 and 8 would allow it if left unset | `NSAllowsArbitraryLoads` `false` **and** `NSAllowsLocalNetworking` `false` |

Production is HTTPS only on both platforms, and it already refuses to build without `EXPO_PUBLIC_API_URL`. iOS needed no addition for development and preview: Expo's template sets `NSAllowsLocalNetworking`, which covers `localhost`, unqualified host names and `.local` names, in every build; production is where it is turned off. Proved with `npx expo prebuild --platform all --clean` for each profile (the generated folders inspected, then deleted):

```text
EAS_BUILD_PROFILE=preview    → android/app/src/main/AndroidManifest.xml  <application … android:usesCleartextTraffic="true">
                               ios/GoShop/Info.plist                     NSAllowsArbitraryLoads false, NSAllowsLocalNetworking true
EAS_BUILD_PROFILE=production → android/app/src/main/AndroidManifest.xml  <application … android:usesCleartextTraffic="false">
  (EXPO_PUBLIC_API_URL set)    ios/GoShop/Info.plist                     NSAllowsArbitraryLoads false, NSAllowsLocalNetworking false
```

Cleartext in a preview build is a convenience for testers against a local or staging API, not a security boundary: anything sent over `http://` can be read on the network, so a preview build pointed at a shared server should use its HTTPS URL. A phone on Wi-Fi still needs `EXPO_PUBLIC_API_URL` set to the computer's LAN address (artikel 02); cleartext only stops Android from refusing the connection.

### What to check on the devices

The checks in this commit are `tsc`, ESLint and Prettier, `expo export` for both platforms (and the unminified bundle, which holds the compiled classes `w-1/2`, `border-b-hairline`, `android:py-1.5`, `placeholder:text-muted-foreground` → `placeholderTextColor`), `expo prebuild` per profile and `expo-doctor`. On the Android emulator and the iOS simulator, against `make up` with seeded products:

1. The first page arrives: two cards per row, photos from the API's variants, prices in rupiah, "Stok habis" on sold-out products, the caption "Semua produk · Terbaru".
2. Scrolling near the end loads the next page once (one `cursor=` request per page in the API log or DevTools' network panel), a spinner shows below the last row, and the end shows "Semua produk sudah ditampilkan."
3. A search (`kaos` + the keyboard's search key) and each sort in the sheet change the request (`q=`, `sort=price_asc`/`price_desc`) and start from the top; a search with no match says "Tidak ada produk yang cocok."; `goshop://?q=kaos&urut=termurah` opens that list.
4. A category from the Kategori tab (or `goshop://?kategori=kaos`): `category=kaos` in the request, the chip with the category's name (its slug after a cold deep link), the chip's press back to every product; a sort picked in the sheet keeps the category and the search; `goshop://?kategori=tidak-ada` shows "Kategori ini tidak ada." and "Lihat semua produk" works.
5. Pull-to-refresh after scrolling several pages: the spinner shows, **one** request (no `cursor`), the list keeps working when scrolled again.
6. Leave the app for more than 30 s and come back: one refetch, **no** pull-to-refresh spinner.
7. Stop the API before opening the app: the error, a request ID when the API answered, "Coba lagi" recovers once the API is back. Stop it while scrolled: the next page fails in the footer, the rows stay.
8. Airplane mode before the first load: the "Tidak ada koneksi internet" message; turning it off loads the list without a tap.
9. Dark mode: top bar, search field (placeholder colour), captions, spinners, error and empty text, refresh spinner.
10. The keyboard: dragging the list closes it (interactive on iOS), a tap on a card while it is open opens the product at the first touch.
11. A `preview` APK (`eas build --local --platform android --profile preview`, or Gradle `assembleRelease` after `EAS_BUILD_PROFILE=preview npx expo prebuild`) installed on the emulator reaches `http://10.0.2.2:8080` and shows the catalog; `aapt dump xmltree <apk> AndroidManifest.xml` shows `usesCleartextTraffic` true. A production build's manifest shows it false.
12. iOS preview (simulator) build reaches `http://localhost:8080`.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                                                                   | Where to read it                                                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| The `QueryClient`, its defaults, `AppState` → focus, `expo-network` → online                              | `src/lib/query-client.ts`                                                         |
| The provider around every screen                                                                          | `app/_layout.tsx` (`QueryClientProvider`)                                         |
| Route parameters → API filters (`kategori` → `category`, `q`, `urut` → `sort`)                            | `src/features/catalog/catalog-filters.ts`, `src/features/catalog/sort-options.ts` |
| Query keys, the categories query (shared with Kategori), the infinite query over `fetchProductPage`       | `src/features/catalog/api/queries.ts`, `src/features/catalog/api/products.ts`     |
| Flattened pages, pull-to-refresh of the first page, `isRefreshing`                                        | `src/features/catalog/hooks/useProductList.ts`                                    |
| The list (a `FlashList` since artikel 07): columns, header, empty, footer, end reached, refresh, keyboard | `src/features/catalog/components/ProductList.tsx`                                 |
| The footer states                                                                                         | `src/features/catalog/components/ProductListFooter.tsx`                           |
| Loading, empty and error with retry                                                                       | `src/components/StatusMessage.tsx`, `src/lib/error-message.ts`                    |
| The category chip and the unknown-category state                                                          | `src/features/catalog/components/ProductList.tsx`, `app/(tabs)/index.tsx`         |
| The sort sheet handing the other filters back                                                             | `app/filter.tsx`                                                                  |
| The screen and its top bar in `className`                                                                 | `app/(tabs)/index.tsx`                                                            |
| The search field in `className`, the `placeholder:` variant                                               | `src/features/catalog/components/SearchBar.tsx`                                   |
| Cleartext and App Transport Security per profile                                                          | `app.config.ts` (`buildProfile`, `expo-build-properties`, `infoPlist`)            |

## ScrollView vs FlatList vs FlashList (artikel 07)

Three ways to put many products on a phone screen, measured with the same card on the same device, and a decision from the numbers: Beranda's catalog is a `FlashList` from `@shopify/flash-list` 2.3.2 (the version `npx expo install` picks for SDK 58) instead of the `FlatList` of artikel 06.

### The mental model

| List                                   | What it does with 500 products                                                                                                                                                                                                                                  | Cost                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ScrollView` with `products.map(…)`    | Mounts all 500 cards before the first frame and keeps them, each a native view with a decoded photo. The web's `<ul>` habit                                                                                                                                     | Time to the first frame and memory grow with the list; fine for a dozen rows (the sort sheet's three options)  |
| `FlatList` (React Native, artikel 06)  | A `VirtualizedList`: mounts the rows near the screen (`windowSize` 21, about ten screens above and below), unmounts the rest and leaves blank space of their measured height                                                                                    | Mounting and unmounting while the buyer scrolls; about fifty to a hundred cards alive                          |
| `FlashList` (Shopify, JavaScript only) | Mounts about a screen of cells plus `drawDistance` (250 dp) and **recycles** them: a cell that leaves the top is re-rendered with the product arriving at the bottom, without unmounting. Built for the New Architecture, where it measures cells synchronously | A dependency, and a rule: no state inside a cell, because a recycled cell keeps its state for the next product |

### How it was measured

- **Device**: the Android emulator, AVD `Pixel_2_API_33` (Android 13, arm64-v8a, 1080 × 1920 at 420 dpi) on an Apple M2 Pro. An emulator draws with the host's GPU and shares its CPU, so the numbers are **relative**: they compare the three lists with each other, they do not predict a real phone.
- **Build**: a release APK (`preview` profile, Hermes, the New Architecture), not a development build, whose extra checks make every list slower.
- **Data**: the API seeded with `make seed-large` (the example catalog plus 10,000 generated products) and a photo uploaded the admin's way (presigned `PUT`, confirm, the worker's 400/600 px variants) for the first 1,000 products, so cards draw real photos; past 1,000 they draw the placeholder.
- **Harness**: a temporary screen, not committed, at `goshop://bench?daftar=scrollview|flatlist|flashlist&n=500`. It fetches `n` products first (pages of 100, through `fetchProductPage`), then renders the same `ProductCard` in a two-column list of the chosen kind, so the network is not part of any number. It logs to logcat: the time from handing the list its data to its first `onContentSizeChange` (first content laid out), JavaScript frames per second from a `requestAnimationFrame` loop, and how many cards are mounted (a counter in each card's mount effect). A script cold-starts the app through the deep link, waits six seconds for the photos, reads `dumpsys meminfo` (total PSS), resets `dumpsys gfxinfo`, flings twelve times (`adb shell input swipe 540 1500 540 300 60`, 350 ms apart), then reads `gfxinfo` and PSS again.
- **Runs**: five per list and size, the three kinds interleaved so a slow moment of the emulator hits all of them; the table shows medians. `ScrollView` with 2,000 products ran once: it took two seconds to show anything and dropped every frame of the flings.

| 500 products                            | `ScrollView` | `FlatList` | `FlashList` |
| --------------------------------------- | -----------: | ---------: | ----------: |
| First content laid out                  |       603 ms |      52 ms |       22 ms |
| Cards mounted after load / after flings |    500 / 500 |   54 / 122 |     10 / 12 |
| Memory (PSS) after load                 |       285 MB |     110 MB |      104 MB |
| Memory (PSS) after the flings           |       280 MB |     214 MB |      173 MB |
| Janky frames during the flings          |         31 % |      7.7 % |       3.1 % |
| Frame time p90 / p99                    |   48 / 61 ms | 36 / 48 ms |  27 / 38 ms |
| JavaScript FPS while scrolling          |         44.4 |       56.1 |        58.6 |

| 2,000 products                          | `ScrollView` (1 run) | `FlatList` | `FlashList` |
| --------------------------------------- | -------------------: | ---------: | ----------: |
| First content laid out                  |              2107 ms |      37 ms |       27 ms |
| Cards mounted after load / after flings |          2000 / 2000 |   54 / 122 |     10 / 12 |
| Memory (PSS) after load                 |               609 MB |     118 MB |      111 MB |
| Memory (PSS) after the flings           |               607 MB |     221 MB |      182 MB |
| Janky frames during the flings          |                100 % |      6.6 % |      10.5 % |
| Frame time p90 / p99                    |         350 / 650 ms | 34 / 44 ms |  38 / 46 ms |
| JavaScript FPS while scrolling          |                 20.8 |       56.0 |        55.0 |

What the numbers say, and what they do not:

- **`ScrollView` is out** for the catalog. Everything it mounts, it keeps: 500 cards cost 285 MB and six tenths of a second before the first frame, 2,000 cost 609 MB and two seconds, and the flings dropped frames throughout.
- **Smoothness does not separate `FlatList` from `FlashList` on this emulator.** Janky frames ranged from 0 to 33 % across the five runs of _either_ list, and the medians swap places between 500 and 2,000 products. A real low-end phone is where that comparison would mean something; this measurement cannot settle it, and the README does not claim it.
- **Memory and mounted views do separate them, every run.** FlashList kept 10 to 12 cards alive against FlatList's 54 to 122, and after the same flings used 173 MB against 214 MB (182 against 221 with 2,000): the highest FlashList run was below the lowest FlatList run in both sizes. The first content arrived sooner too (22 against 52 ms), a gap a buyer will not see on this hardware.

### Decisions

- **The catalog uses `FlashList`.** The measured win is memory, about 40 MB (a fifth) after a long scroll, and a tenth of the views mounted; the API pages twenty products at a time, so a buyer who scrolls far builds exactly this kind of list. It costs one JavaScript-only dependency (no native code, so no new development build; it is in Expo Go) and the recycling rule below. The props are FlatList's: `data`, `renderItem`, `keyExtractor`, `numColumns`, the header, footer and empty components, `onEndReached` with its threshold, `refreshControl`, the keyboard props. Everything artikel 06 built around the list (`useProductList`, the footer, the states) is unchanged.
- **No `estimatedItemSize`.** FlashList 1 asked for it; version 2 measures each cell before it paints (the New Architecture's synchronous layout), and the prop is gone.
- **The cell has no width class.** `FlatList` lays out each row as a `View` with `flexDirection: "row"`, so a cell needed `w-1/2`. FlashList positions each cell itself at half the list's width, and gives the two cells of a row the height of the taller one, so the cell is `grow p-1.5` and the card (`grow`, artikel 06) fills it.
- **No state in a card.** A recycled cell is re-rendered with another product, not mounted again. `ProductCard` keeps no `useState`; one that did (a "liked" heart, an image-loaded flag) would carry it to the next product, and would need to reset it from the product's `id`. `memo(ProductCard)` still skips a card whose product did not change.
- **`contentContainerStyle` as numbers.** NativeWind turns `className` props into styles on React Native's own components; FlashList is not one, so `contentContainerClassName="grow px-2.5 pb-4"` became `{ flexGrow: 1, paddingHorizontal: 10, paddingBottom: 16 }` in a constant, the same exception as the safe-area insets.
- **`maintainVisibleContentPosition` is off.** FlashList 2 turns it on by default: when the data changes, it keeps the first visible row where it was, which is what a chat that loads older messages above needs. The catalog only grows at the end. With it on, on the emulator, picking a sort in the sheet returned to a list that went from the loading state to its rows and opened scrolled to the end.
- **One list per filter.** The list has `key={JSON.stringify(filters)}`, as the cache has one entry per filter: a new search, sort or category starts at the top. Without it a list kept its scroll offset, and a result already in the cache (no loading state in between) opened wherever the previous one was scrolled to.
- **The harness is not committed.** It needs a route in `app/`, and every route ships in the app; this section describes it closely enough to rebuild. The measurement is a snapshot of this device and these versions, not a test that guards anything.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                                                 | Where to read it                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| The `FlashList`: cells, content style, filter key, `maintainVisibleContentPosition` off | `src/features/catalog/components/ProductList.tsx` |
| The card that grows into its cell and keeps no state                                    | `src/features/catalog/components/ProductCard.tsx` |
| The version, chosen by `npx expo install`                                               | `package.json` (`@shopify/flash-list`)            |

## Expo Router: routing berbasis file (artikel 08)

The app's screens are files in `app/`. Expo Router reads that folder when Metro bundles the app and builds the navigation from it: a file is a screen, a `_layout.tsx` is the navigator around the files next to it, and the file's path is the screen's URL. It is the same idea as Next's App Router in `apps/web/src/app/`, applied to native navigators instead of HTML pages.

### The mental model

| Idea                                 | What it means                                                                                                                                                                                                                                          | Go comparison                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Every screen has a URL**           | `app/produk/[slug].tsx` is `/produk/:slug` inside the app, whether it is reached by a tap, `router.push`, or a link from outside (`goshop://produk/kaos-polos-hitam`). Navigation state can be written down and shared, as on the web                  | A route in a `http.ServeMux` pattern (`GET /produk/{slug}`): the path decides the handler |
| **A layout is a navigator**          | `_layout.tsx` decides _how_ its children are shown: a `Stack` (screens slide over each other), `Tabs` (a tab bar), or `Slot` (no chrome). Layouts nest, so the tab bar lives inside one screen of the root stack                                       | Middleware wrapping a sub-router: `mux.Handle("/admin/", adminMux)`                       |
| **Groups organise, they add no URL** | A folder in parentheses, `(tabs)`, gives its files a shared layout without a path segment: `app/(tabs)/index.tsx` is `/`, not `/(tabs)`                                                                                                                | A sub-router mounted at the same prefix, only to share middleware                         |
| **Brackets are parameters**          | `[slug]` matches one segment and passes it to the screen as a string through `useLocalSearchParams`. Like a path value from a request, it is outside input: the API decides whether it names a product                                                 | `r.PathValue("slug")`                                                                     |
| **Typed routes**                     | With `experiments.typedRoutes`, Expo generates `.expo/types/router.d.ts` from the files in `app/`. `<Link href>`, `router.push` and `useLocalSearchParams` are then checked against the real routes: a renamed file breaks the build, not a user's tap | `sqlc` generating typed queries from the schema: the compiler knows what exists           |

### The routes

| File                     | Route (and deep link)                                 | Navigator                            | Shows                                                      |
| ------------------------ | ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `app/_layout.tsx`        | (none: a layout)                                      | root `Stack`                         | Every screen below, and the status bar                     |
| `app/(tabs)/_layout.tsx` | (none: a layout; the group adds no segment)           | `Tabs`, one screen of the root stack | The tab bar                                                |
| `app/(tabs)/index.tsx`   | `/` (`goshop://`)                                     | tab "Beranda"                        | The home screen; the catalog from artikel 06               |
| `app/produk/[slug].tsx`  | `/produk/<slug>` (`goshop://produk/kaos-polos-hitam`) | root stack, pushed above the tabs    | Product detail (placeholder: shows the slug in its header) |
| `app/+not-found.tsx`     | any path that matches nothing (`goshop://produkk/x`)  | root stack                           | "Halaman tidak ditemukan" and a link back to Beranda       |

```text
app/
├── _layout.tsx          root Stack
├── (tabs)/
│   ├── _layout.tsx      Tabs
│   └── index.tsx        /            Beranda
├── produk/
│   └── [slug].tsx       /produk/:slug
└── +not-found.tsx       anything else
```

Files whose name starts with `+` or `_` are special (`+not-found`, `_layout`), not routes of their own. In development Expo Router also serves `/_sitemap`, a list of every route, handy for checking what the folder turned into.

### Deep links

`app.config.ts` sets `scheme: "goshop"`, which registers `goshop://` with the operating system in a native build (an intent filter in Android's manifest, `CFBundleURLTypes` in iOS's `Info.plist`, both written by prebuild). Expo Router turns the rest of the link into a route, so `goshop://produk/kaos-polos-hitam` opens the detail screen on top of the tabs, with a back button to Beranda. There is no link table to maintain: the files are the table.

To try one, with the app installed on the emulator or simulator:

```bash
# either platform, through Expo's helper (it runs adb or xcrun for you)
npx uri-scheme open "goshop://produk/kaos-polos-hitam" --android
npx uri-scheme open "goshop://produk/kaos-polos-hitam" --ios

# the same thing by hand
adb shell am start -W -a android.intent.action.VIEW \
  -d "goshop://produk/kaos-polos-hitam" com.santekno.goshop
xcrun simctl openurl booted "goshop://produk/kaos-polos-hitam"
```

Expo Go is a different app with its own scheme, so `goshop://` does not reach it. There the same route is `exp://<metro address>:8081/--/produk/kaos-polos-hitam` (the `--/` separates Metro's address from the route); `npx uri-scheme open` accepts that URL too. The `goshop://` scheme works in a development build or a preview build.

### Decisions

- **Routes are Indonesian, like the storefront's.** `/produk/<slug>` is the same path as `apps/web` uses, so a product link reads the same on the web and in the app, and a later universal link (`https://…/produk/<slug>` opening the app) maps one to one.
- **Tabs in a group, the detail outside it.** `produk/[slug]` lives next to `(tabs)`, not inside it, so it is a screen of the root stack and covers the tab bar when it opens, the usual shape of a shop app. Artikel 09 builds the rest of this tree.
- **`Tabs` from `expo-router/js-tabs`.** Expo Router 58 deprecates importing `Tabs` from `expo-router`: it now offers two tab bars, the JavaScript one (React Navigation's bottom tabs, `expo-router/js-tabs`) and the platform's own (`expo-router/native-tabs`). The JavaScript one draws the same tab bar on both platforms and takes any React element as an icon (artikel 09).
- **Typed routes are checked by `pnpm typecheck`, on a fresh clone too.** Expo writes the route types when `expo start` runs. A clone that never started Metro has none, and then every href is a plain string. So `typecheck` first runs `expo customize tsconfig.json`, the CLI command that runs the same type generation without starting a server (about two seconds), then `tsc`. `tsconfig.json` already lists everything Expo wants in `include` (`.expo/types/**/*.ts`, `expo-env.d.ts`), and `.gitignore` lists `expo-env.d.ts` in the exact form the CLI looks for; otherwise every `expo start` would rewrite `tsconfig.json` without its comments and append a block to `.gitignore`.
- **A card opens its product.** The card's `onPress` (artikel 03) stops showing an `Alert`: Beranda's `openProduct` calls `router.push({ pathname: "/produk/[slug]", params: { slug: product.slug } })`, the object form of a typed href, so a wrong pathname or a missing `slug` fails `tsc`. `push` puts the detail on the root stack above the tabs, with a back button to the list. Since artikel 06 `openProduct` lives in `ProductList.tsx`, beside the `FlatList` that renders the cards.
- **The screen reads the parameter, the header shows it.** `[slug].tsx` sets its own title with `<Stack.Screen options={…} />` while it renders. The real screen fetches `GET /v1/products/{slug}` and shows the product's name; a slug the API does not know is a "not found" state of that screen, not `+not-found` (which is for paths that match no route at all).

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                            | Where to read it                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| The scheme and typed routes                        | `app.config.ts` (`scheme`, `experiments`)                         |
| The root stack and its screens                     | `app/_layout.tsx`                                                 |
| The tab group                                      | `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`                  |
| A dynamic route and its parameter                  | `app/produk/[slug].tsx`                                           |
| A card's press → `router.push` to `/produk/[slug]` | `src/features/catalog/components/ProductList.tsx` (`openProduct`) |
| Paths that match nothing                           | `app/+not-found.tsx`                                              |
| Route type generation in `pnpm typecheck`          | `package.json` (`typecheck`), `tsconfig.json`                     |

## Navigasi tab, stack dan modal (artikel 09)

A web app has one kind of navigation: the page changes and the back button goes to the previous URL. A phone app mixes three, and the user expects each to behave the way every other app on their phone does: **tabs** for the app's main sections, a **stack** for going deeper into one thing and back out, and a **modal** for a short task that interrupts and is then closed. Artikel 08 gave every screen a URL; this article decides how each one is presented.

### The mental model

| Navigator | What the user sees                                                                                                                                    | When to use it                                                                | In this app                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| **Tabs**  | A bar of sections at the bottom. Switching keeps each tab's own state (its scroll position, its own pushed screens): tabs are parallel, not a history | The few top-level sections a user moves between all the time                  | Beranda, Kategori, Keranjang, Akun             |
| **Stack** | Each screen enters over the previous one with the platform's own transition, with a back button, the iOS edge swipe and Android's back gesture        | Going deeper: a list, then one item. Back means "one level up"                | The root stack: the tabs, then a product above |
| **Modal** | A screen over everything, tab bar included. iOS slides up a card the user swipes down; Android shows a full screen closed with back                   | A self-contained task that ends with "done" or "cancel": sort, filter, a form | The sort sheet, `/filter`                      |

The navigators nest. The root stack holds the tab navigator as its first screen; a product or the sort sheet is pushed on the root stack, so it covers the tab bar. Had `produk/[slug]` lived inside `(tabs)`, the detail would open inside the Beranda tab with the tab bar still showing, which is a valid design too (each tab its own stack) but needs a stack per tab.

### The navigation tree

```text
Root Stack                       app/_layout.tsx
├── (tabs)  header hidden        app/(tabs)/_layout.tsx  (Tabs)
│   ├── Beranda     /            app/(tabs)/index.tsx
│   ├── Kategori    /kategori    app/(tabs)/kategori.tsx
│   ├── Keranjang   /keranjang   app/(tabs)/keranjang.tsx
│   └── Akun        /akun        app/(tabs)/akun.tsx
├── Produk          /produk/:slug  pushed            app/produk/[slug].tsx
├── Urutkan         /filter        modal             app/filter.tsx
└── Tidak ditemukan (any other path)                 app/+not-found.tsx
```

| Route           | Presented as               | Header                                          | Reached from                                    |
| --------------- | -------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `/` and tabs    | tab, under the tab bar     | the tab's own (one per tab), not the stack's    | launch, `goshop://`, the tab bar                |
| `/produk/:slug` | stack push, above the tabs | the stack's, with back; title set by the screen | a product link, `goshop://produk/<slug>`        |
| `/filter`       | modal                      | the stack's, title "Urutkan"; "Tutup" on iOS    | "Urutkan" on Beranda (`/filter?urut=<current>`) |

### How the sort sheet talks back

The modal does not call a function on Beranda or share a store with it. Beranda opens `/filter?urut=terbaru`, so the sheet knows what to tick; picking an option calls `router.dismissTo({ pathname: "/", params: { urut: "termurah" } })`, which closes the modal and returns to the Beranda already underneath with the new parameter. Beranda reads `urut` with `useLocalSearchParams` and turns it into a sort order with `sortFromParam`. The words are the storefront's (`?urut=termurah`), so `goshop://?urut=termurah` and the web's `/?urut=termurah` mean the same thing. A parameter is outside input, so an unknown word falls back to "Terbaru" rather than reaching the API.

### Decisions

- **JavaScript tabs, not native tabs, for now.** `expo-router/js-tabs` draws the tab bar in React and looks the same on both platforms; `expo-router/native-tabs` uses `UITabBarController` and Material's bottom navigation, which look native (including iOS 26's glass tab bar) but take SF Symbols and Android drawables instead of any React element. With one icon component (below), switching later is a change to one layout file.
- **One icon component.** Screens use `<Icon name="keranjang" />` from `src/components/Icon.tsx`, a name that says what the icon means, mapped to an Ionicons glyph in one table. Tabs show the filled glyph when selected and the outline otherwise, in the tint colour the tab bar passes. Artikel 11 may change the icon set; nothing outside that file needs to know.
- **`@expo/vector-icons` 15.1.1 and `expo-font` 58.0.11.** Ionicons is an icon font: a `.ttf` (about 390 KB, bundled by `expo export`) that `expo-font` loads at run time. `expo-font` is a peer dependency of `@expo/vector-icons` and a native module, so it is listed in `package.json` itself (`expo-doctor` fails without it): a development or preview build must contain it. Expo Go already does.
- **The close button exists on iOS only.** An iOS modal is a card with no back button; users swipe it down, and a "Tutup" button in the header is the visible way out. Android's modal has the header's back arrow and the system back gesture, so the screen adds no second close.
- **`dismissTo`, not `push`, to go back with a result.** Pushing `/` would put a second Beranda on top of the stack, with the modal still underneath it.
- **Placeholders are real routes.** Kategori, Keranjang and Akun render `ScreenPlaceholder`; the tab bar, deep links (`goshop://keranjang`) and route types already include them, and each later chapter replaces one file.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                   | Where to read it                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The root stack: tabs, push, modal         | `app/_layout.tsx`                                                                                    |
| The tab bar and its icons                 | `app/(tabs)/_layout.tsx`                                                                             |
| The four tabs                             | `app/(tabs)/index.tsx`, `app/(tabs)/kategori.tsx`, `app/(tabs)/keranjang.tsx`, `app/(tabs)/akun.tsx` |
| The modal and how it returns a choice     | `app/filter.tsx`                                                                                     |
| Sort orders and reading them from a route | `src/features/catalog/sort-options.ts`                                                               |
| Icons                                     | `src/components/Icon.tsx`                                                                            |
| A screen whose feature comes later        | `src/components/ScreenPlaceholder.tsx`                                                               |

## Safe area, status bar dan keyboard (artikel 10)

A browser gives a web page a rectangle that nothing else draws on. A phone app gets the whole screen, and the system draws on top of it: the status bar and the notch or camera cut-out at the top, the home indicator (iOS) or the navigation bar (Android) at the bottom, the rounded corners, and the keyboard whenever a field is focused. Keeping content out from under them is the app's job. This article does it for every screen so far, and gives Beranda a search field to prove the keyboard part.

### The mental model

| Idea                             | What it means                                                                                                                                                                                                                                        | Web comparison                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Edge to edge**                 | The app is drawn under the status bar and the bottom system bar on both platforms. Android 15 enforces it and Expo SDK 58 always turns it on (`edgeToEdgeEnabled=true` in the generated `android/gradle.properties`); iOS has always worked this way | `viewport-fit=cover`, permanently on                                             |
| **Safe-area insets**             | Four numbers (top, right, bottom, left) for how much of each edge the system covers on _this_ device, in this orientation. `react-native-safe-area-context` measures them natively; a screen pads by them                                            | `env(safe-area-inset-top)` and friends                                           |
| **Who owns which edge**          | A navigation header already sits below the status bar, and a tab bar already sits above the home indicator. A screen pads only the edges nothing else covers                                                                                         | A sticky header that already includes the inset                                  |
| **The status bar is an overlay** | It has no background of its own any more (edge to edge); `expo-status-bar` only chooses dark or light icons, which must contrast with whatever the app draws behind them                                                                             | `<meta name="theme-color">`, except that you pick the icon colour, not the bar's |
| **The keyboard covers the app**  | It slides up over the bottom of the screen. Android can resize the app's window to the space above it; iOS never does, so the app shrinks its own layout by the keyboard's height                                                                    | A virtual keyboard on mobile Safari, which pans the page instead                 |

### Which screen handles which edge

| Screen                    | Top                                                                               | Bottom                                                | How                                                |
| ------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Beranda                   | its own top bar (no header): `insets.top`, plus left/right for landscape cut-outs | the tab bar                                           | `useSafeAreaInsets()` in `app/(tabs)/index.tsx`    |
| Kategori, Keranjang, Akun | the tab's header                                                                  | the tab bar                                           | nothing to do                                      |
| Produk (`/produk/:slug`)  | the stack's header                                                                | **nothing**: it is pushed above the tabs              | `<SafeAreaView edges={["bottom"]}>`                |
| Urutkan (modal)           | the modal's header                                                                | **nothing**: the home indicator or the navigation bar | `insets.bottom` added to the list's bottom padding |

Two ways to read the insets, both from `react-native-safe-area-context`: the `useSafeAreaInsets()` hook gives the numbers, for a screen that adds them to its own padding (Beranda, the modal); `<SafeAreaView edges={…}>` is a `View` that pads itself, for a screen that only needs the padding (Produk). Pass `edges` every time: a `SafeAreaView` without it pads all four edges, which under a header adds the status bar's height twice. React Native's own `SafeAreaView` is iOS-only and deprecated; do not use it.

### The keyboard on Beranda

The search field sits in Beranda's top bar, so the keyboard never covers the field itself. What it can cover is everything below: the end of the list and the tab bar. The pieces:

| Piece                                             | What it does                                                                                                                                                                                    | iOS                                                   | Android                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `KeyboardAvoidingView`                            | Shrinks the screen by the part the keyboard covers, so the list ends above it                                                                                                                   | `behavior="padding"`: the window never resizes        | no `behavior`: the window already resizes (`softwareKeyboardLayoutMode: "resize"`, Expo's default, `adjustResize` in the manifest) |
| `tabBarHideOnKeyboard` (`app/(tabs)/_layout.tsx`) | Hides the tab bar while the keyboard is open                                                                                                                                                    | the keyboard covers the bar anyway                    | without it, the resized window would lift the tab bar onto the keyboard                                                            |
| `keyboardDismissMode`                             | Dragging the list puts the keyboard away                                                                                                                                                        | `"interactive"`: the keyboard follows the finger down | `"on-drag"`: Android has no interactive dismissal                                                                                  |
| `keyboardShouldPersistTaps="handled"`             | A tap on a link or button in the list works at the first touch; a tap on empty space closes the keyboard. The default (`"never"`) would swallow the first tap on a button to close the keyboard | same                                                  | same                                                                                                                               |
| `enterKeyHint="search"`, `inputMode="search"`     | The keyboard's action key reads "search"; pressing it submits and closes the keyboard                                                                                                           | a blue "search" key                                   | a magnifier key                                                                                                                    |
| `clearButtonMode="while-editing"`                 | A clear button inside the field                                                                                                                                                                 | shown                                                 | ignored: Android text fields have none                                                                                             |
| the system back gesture                           | Closes the keyboard first, then navigates                                                                                                                                                       | (no back gesture for this)                            | built in                                                                                                                           |

Submitting puts the search into the route, `router.setParams({ q })`, so Beranda is `/?q=kaos`, the same shape as the storefront's `/?q=kaos`, and `goshop://?q=kaos` opens a search directly. The catalog (artikel 06) reads `q` and `urut` from the route and asks the API with them. The field keeps its own text while the user types and is re-created (`key={query}`) when the route's search changes from outside, such as a deep link.

### The status bar and the theme

`app/_layout.tsx` wraps the navigation in `ThemeProvider` with `navigationTheme(scheme)` (artikel 05: React Navigation's `DefaultTheme` or `DarkTheme` in GoShop's colours), the scheme picked by `useColorScheme()` (the device setting; `app.config.ts` has `userInterfaceStyle: "automatic"`). Headers, the tab bar and screen backgrounds follow it, and screens read the same colours with `useTheme()`, because text in React Native is black unless styled, whatever the theme. `<StatusBar style="auto" />` picks dark icons in light mode and light icons in dark mode, from the same setting, so the icons always contrast with the header or top bar behind them. On Android, `StatusBar`'s `backgroundColor` and `translucent` do nothing any more: edge to edge, the bar is always transparent, and what shows through it is whatever the app draws there.

### Decisions

- **`KeyboardAvoidingView`, not `react-native-keyboard-controller`.** Expo's keyboard guide recommends the built-in component for a screen like this one (`padding` on iOS, nothing on Android) and keyboard-controller for long forms, toolbars between inputs, and animations synced to the keyboard. keyboard-controller is a native module that needs `react-native-reanimated` and a development build (Expo Go does not contain it), which is a lot of machinery for one search field at the top of a screen. The checkout form, when it arrives, is the place to revisit this.
- **No second `SafeAreaProvider`.** Expo Router mounts one around the whole app; the insets are available on every screen without adding one to `app/_layout.tsx`.
- **Beranda has its own top bar instead of a header.** A shop's home screen puts the search field first, and a header with a search field inside it (`headerSearchBarOptions`) behaves differently on each platform and only works in a native stack, not in a tab. Drawing the bar in the screen keeps one layout for both platforms, at the price of handling the top inset by hand.
- **Colours come from the navigation theme, in plain `StyleSheet`.** The screens of this article read their colours with `useTheme()` rather than NativeWind's classes (artikel 05); both come from the same roles in `src/theme/colors.js`, so they match. The placeholder colour of the search field is a grey that reads on both themes.
- **Not verified on a device in this article's commit.** The checks here are `tsc`, ESLint, `expo export` for both platforms and `expo prebuild` (which writes `adjustResize` and `edgeToEdgeEnabled=true`, as described above). How the keyboard and the insets look on the Android emulator and the iOS simulator is checked with the chapter's native builds.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                  | Where to read it                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Theme and status bar                                     | `app/_layout.tsx`                                                   |
| A screen that draws its own top bar under the status bar | `app/(tabs)/index.tsx` (`useSafeAreaInsets`)                        |
| Keyboard avoidance and dismissal                         | `app/(tabs)/index.tsx` (`KeyboardAvoidingView`, the `ScrollView`)   |
| The tab bar hiding while typing                          | `app/(tabs)/_layout.tsx` (`tabBarHideOnKeyboard`)                   |
| The search field                                         | `src/features/catalog/components/SearchBar.tsx`                     |
| A bottom edge with nothing in front of it                | `app/produk/[slug].tsx` (`SafeAreaView`), `app/filter.tsx` (insets) |

## Font dan ikon custom (artikel 11)

Until now the app spoke in the phone's own voice: Roboto on Android, San Francisco on iOS, Ionicons for the tabs, and Expo's placeholder icon and white launch screen. This article gives GoShop its own: the Inter typeface on both platforms, the same icon drawings the website uses, and an app icon and splash screen drawn from a GoShop mark. All of it is native configuration, so it needs a new development build; none of it is a screen.

### The mental model

| Idea                                   | What it means                                                                                                                                                                                                                                                                    | Web comparison                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **A font is part of the app binary**   | `expo-font`'s config plugin copies the `.ttf` files into the native projects at `expo prebuild`: `res/font/` plus a `<font-family>` resource on Android, the app bundle plus `UIAppFonts` in `Info.plist` on iOS. The OS knows the font before the first line of JavaScript runs | A font installed on the user's machine, not a `@font-face` download |
| **One family name, a weight per file** | `fontFamily: "Inter"` with `fontWeight: "600"` picks `Inter-SemiBold.ttf`. On Android that is only true because the plugin writes the four files into one `font-family` resource named `Inter`; a font loaded any other way on Android is one family per file                    | `font-family: Inter; font-weight: 600` with four `@font-face` rules |
| **No inheritance from a View**         | A `Text` gets no font from the `View` around it, only from a `Text` around it. So every `Text` says `font-sans`, and the headers and tab labels, which Expo Router draws, get Inter from the navigation theme                                                                    | `body { font-family }` inherited by every element                   |
| **An icon is a drawing, not a glyph**  | `Icon` draws an SVG path with `react-native-svg`; the colour is the `Svg`'s `color`, which the paths use as `currentColor`                                                                                                                                                       | `lucide-react`'s `<ShoppingCart />`, an inline `<svg>`              |
| **The launch screen is not React**     | The OS shows it while the app process starts, from the image and colours `expo-splash-screen` wrote into the native projects (Android 12+'s SplashScreen API, iOS's launch storyboard); it hides when the first screen has drawn                                                 | Nothing: a page has no launch screen, only a blank tab              |
| **The app icon is a set of images**    | One 1024 px source becomes every size each launcher needs at prebuild. Android's adaptive icon is two layers (a foreground image, a background colour) that the launcher masks to its own shape                                                                                  | `favicon.ico`, `apple-touch-icon`                                   |

### Which font, and why Inter

`apps/web` and `apps/admin` use no web font: `--font-sans` in their `index.css` is the system stack (`system-ui, -apple-system, "Segoe UI", Roboto …`), for no download and no layout shift. On a phone the system font is already the default, so the cheapest match to the web is to change nothing. The app takes Inter instead, because a shop's app should look the same on every phone, and Roboto and San Francisco differ in width and rhythm: a product name that fits two lines on one wraps to three on the other. Inter is the closest open font to the web's system stack in spirit: a neutral sans-serif drawn for screens, with full Latin coverage for Indonesian. It is under the SIL Open Font License 1.1, which allows bundling it in an app; the license travels with the files (`assets/fonts/OFL.txt`).

The files are Inter 4.1's static TTFs (`extras/ttf/` in the release archive from github.com/rsms/inter), four weights: 400, 500, 600, 700. 400 and 600 are the app's own (`font-normal`, `font-semibold`); 500 and 600 are what React Navigation uses for tab labels and header titles; 700 for a heading. Each is about 410 KB, 1.67 MB together (0.8 MB compressed, which is roughly what they add to the APK or IPA). Inter also comes as one variable font (880 KB for every weight), which Android's plugin can map to weights; iOS does not reliably pick weights of a variable font by `fontWeight`, so the static files are the safe choice for both.

### Embedded at build time, or loaded at run time

There are two ways to get a font into an Expo app, and this app uses the first:

|                            | Config plugin (this app)                                                                                                 | `useFonts` at run time                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Where it is configured     | `app.config.ts`, the `expo-font` plugin                                                                                  | the root layout, `useFonts({ "Inter-SemiBold": require("…ttf") })`                                                 |
| When the font is there     | before the app starts                                                                                                    | after an async load; until then a `Text` would draw in the system font                                             |
| What the first frame needs | nothing                                                                                                                  | `SplashScreen.preventAutoHideAsync()`, then `hideAsync()` once loaded, so nobody sees the switch                   |
| Family names               | `Inter` + `fontWeight`, on both platforms                                                                                | one family per file (`Inter-SemiBold`), and `fontWeight` left unset, or Android fakes a bold over the regular file |
| Expo Go                    | not available (the fonts are in the native build, and Expo Go is a build of its own); text falls back to the system font | works                                                                                                              |
| Changing it                | a new native build                                                                                                       | a JavaScript reload                                                                                                |

The runtime version, for a reader who stays in Expo Go:

```tsx
// app/_layout.tsx
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

// Keep the launch screen up past the first render, until the fonts are in.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    "Inter-Regular": require("../assets/fonts/Inter-Regular.ttf"),
    "Inter-SemiBold": require("../assets/fonts/Inter-SemiBold.ttf"),
  });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);
  // A failed load still shows the app, in the system font.
  if (!loaded && !error) return null;
  // … the ThemeProvider and Stack as before
}
```

and in `tailwind.config.js` a family per weight (`sans: ["Inter-Regular"], "sans-semibold": ["Inter-SemiBold"]`), used as `font-sans-semibold` instead of `font-sans font-semibold`. The plugin version needs none of that: no code in the layout, no splash hold, and the weight classes mean what they mean on the web. The price is that fonts change only with a native build, which for a shop's typeface is the right trade.

### Icons: Ionicons or SVG, measured

The tab bar, the sort button, the search field and the sort sheet's check mark used Ionicons from `@expo/vector-icons`, an icon font. The app now draws Lucide's icons as SVG with `react-native-svg`, the same drawings `apps/web` and `apps/admin` get from `lucide-react`. Measured with `pnpm build` (`expo export`, Hermes bytecode) on this commit's parent and on this commit:

|                           | Ionicons (before)                                                                        | SVG (after)                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font asset                | `Ionicons.ttf`, 389,724 B, 1,357 glyphs; the app used 14 (7 icons, filled and outlined)  | none                                                                                                                                                     |
| JavaScript, Android / iOS | 4,460,394 / 4,476,917 B                                                                  | +114,504 / +113,462 B for `react-native-svg` and the paths (measured with only the icons changed); +125,161 / +124,049 B with everything in this article |
| At run time               | the font loads before an icon can draw (`@expo/vector-icons` draws nothing until it has) | nothing to load                                                                                                                                          |
| Native code               | none (`expo-font` was already there)                                                     | `react-native-svg`, a native module: a new development build; it is in Expo Go                                                                           |

So the JavaScript and assets an update ships are about 265 KB smaller per platform, and icons draw on the first frame. The native side is not measured here: `react-native-svg` adds compiled code to the APK and the app binary, roughly the size of the font it replaces, and the chapter's native builds are where that number gets recorded. What decided it beyond the bytes: one icon set for the shop on every surface, and an icon is now a component that takes a colour class like any `Text`.

Only the icons used are in the app: their paths are copied into `src/components/Icon.tsx`, not imported from a package (`lucide-react-native` would bring the whole set into the dependency tree for Metro to resolve). Lucide is under the ISC License, whose notice is kept at the top of that file.

### The GoShop mark, the app icon and the splash screen

`assets/brand/render.sh` draws the mark (a shopping bag with a G cut out of it, `goshop-mark.svg`) and renders every image from it with `rsvg-convert`. The G is a hole, not a second colour, so whatever is behind the mark shows through: the icon's background layer, the splash colour, Android's themed-icon tint. Colours are the roles in `src/theme/colors.js`, and `app.config.ts` reads the same file.

| Image                                                                    | Used for                                                                | What `expo prebuild` makes of it                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon.png` (white mark on `primary`, opaque)                             | iOS icon; fallback                                                      | `AppIcon.appiconset/App-Icon-1024x1024@1x.png`                                                                                                                                                                                                                                                                                         |
| `icon-dark.png` (`primary` dark, transparent)                            | iOS 18 dark icon (`ios.icon.dark`)                                      | the same appiconset, `"appearance": "luminosity", "value": "dark"`                                                                                                                                                                                                                                                                     |
| `adaptive-icon.png` (white mark, transparent, inside the 66 % safe zone) | Android foreground layer and Android 13 themed icon (`monochromeImage`) | `mipmap-*/ic_launcher_foreground.webp`, `ic_launcher_monochrome.webp`, and `mipmap-anydpi-v26/ic_launcher.xml` with `@color/iconBackground` (`#0b5cad`) behind                                                                                                                                                                         |
| `splash-icon.png`, `splash-icon-dark.png`                                | the launch screen, light and dark                                       | Android: `drawable-*/splashscreen_logo.png` and `drawable-night-*/`, `splashscreen_background` `#f6f8fa` in `values/` and `#0d1117` in `values-night/`, `Theme.App.SplashScreen`; iOS: `SplashScreenLogo.imageset` (light and dark), `SplashScreenBackground.colorset` with a dark appearance, `SplashScreen.storyboard` (200 pt wide) |

The splash hides by itself when the first screen renders; nothing holds it, since no font is loaded at run time.

### Decisions

- **Inter, embedded with the config plugin.** Reasons above. `src/theme/fonts.js` lists the family and the files once, for `app.config.ts`, `tailwind.config.js` and the navigation theme, the way `colors.js` does for colours.
- **`font-sans` written on every `Text`.** React Native has no way to set a default font for all text (`Text.defaultProps` is gone in React 19), and a wrapper `Text` component would be a second way to write text next to the core one. A nested `Text` inherits from its parent `Text`, so only the outer one needs it.
- **`fontFamily` under `extend`.** NativeWind's preset sets its own `font-sans` and `font-mono` under `extend`, which would override a plain `theme.fontFamily`. `font-mono` is `Menlo` on iOS and `monospace` on Android (`platformSelect`): the Produk placeholder asked for `"monospace"`, a name iOS does not know, so on iOS it was drawn in the system font.
- **The navigation theme carries Inter.** Header titles, the back label and tab labels are drawn by React Navigation from `theme.fonts`; `src/theme/navigation.ts` sets its four styles to Inter at 400/500/600/700.
- **Lucide, outlines only.** The tab bar showed a filled icon for the selected tab and outlines for the others. Lucide has outlines only; `filled` now means a heavier stroke (2.5 instead of 2), and the tab's colour does the rest.
- **Icons named by meaning.** Besides the tab and toolbar icons, `Icon` has `lanjut` (chevron-right) for a row that opens another screen, the Kategori rows (artikel 14), and `tutup` (x) for removing something, the catalog's category chip.
- **`Icon` takes `color` or `className`.** `cssInterop(Svg, { className: { target: "style", nativeStyleToProp: { color: true } } })` lets a `text-*` class (with its `dark:` twin) colour the icon, so screens styled with NativeWind need no colour value; the tab bar, which hands its icon a colour, passes `color`.
- **`@expo/vector-icons` removed** as a dependency: nothing imports it any more. `react-native-svg` 15.16.0 and `expo-splash-screen` 58.0.12 are added (both from `npx expo install`, pinned exactly like the rest).
- **The images are committed, the script beside them.** A build needs only the PNGs; `render.sh` is there for the next change of colour or shape (`brew install librsvg` for `rsvg-convert`).
- **Checked here:** `tsc`, ESLint, Prettier, `expo export` for both platforms, `expo-doctor` (20/20), and `npx expo prebuild --platform all --clean`, whose output is the right-hand column of the table above plus `ReactFontManager.getInstance().addCustomFont(this, "Inter", R.font.xml_inter)` in `MainApplication.kt` and the four files in `Info.plist`'s `UIAppFonts`. **Still to see on a device:** Inter at each weight on both platforms (on iOS, the Medium and SemiBold files declare `Inter` as their typographic family; if iOS groups them under `Inter Medium` instead, those weights fall back to the nearest of Regular and Bold), the icons, the adaptive icon in round and squircle launchers, and the splash in light and dark.

### NativeWind from here on

Artikel 05 brought NativeWind to the catalog; the screens written after it (the placeholders, Produk, the sort sheet, the not-found screen) still used `StyleSheet` with colours from `useTheme()`. They are converted, so that from this article on the app has one way to style a component, `className` with the colour roles and their `dark:` twins, and Inter arrives on them with `font-sans`. Behaviour is unchanged; the visible differences are the font, Tailwind's line heights that come with `text-base`/`text-2xl` (24 and 32), and `font-mono` now being a real monospace font on iOS.

| File                                                               | Was                                                                    | Is                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/ScreenPlaceholder.tsx` (Kategori, Keranjang, Akun) | `StyleSheet` + `colors.text`                                           | `flex-1 items-center justify-center gap-2 p-6`, `text-foreground dark:text-foreground-dark`                                                                                                                                                                                                                       |
| `app/+not-found.tsx`                                               | same, and `Link` styled with `colors.primary`                          | classes; the link is `<Link asChild><Text className="… text-primary dark:text-primary-dark"></Link>`, because `Link`'s own `Text` comes precompiled from `expo-router` and never sees a `className`                                                                                                               |
| `app/produk/[slug].tsx`                                            | `StyleSheet`, `fontFamily: "monospace"`                                | classes, `font-mono`; `SafeAreaView` keeps `style={{ flex: 1 }}`, since NativeWind only knows the core components and those registered with `cssInterop`                                                                                                                                                          |
| `app/filter.tsx`                                                   | `StyleSheet`, the `pressed` style function, `StyleSheet.hairlineWidth` | `active:opacity-60`, `border-b-hairline` (`hairlineWidth()` from `nativewind/theme`, added to `tailwind.config.js`), `contentContainerClassName` for the fixed padding beside `contentContainerStyle` for the measured bottom inset; the check mark is `<Icon className="text-primary dark:text-primary-dark" />` |

**`useTheme()` stays only where React Navigation needs colour values**: the navigators draw headers, the tab bar and screen backgrounds themselves, outside any component a class can reach, and the tab bar hands its icon a colour (`tabBarIcon`'s `color`). That is `app/_layout.tsx`'s `ThemeProvider` with `src/theme/navigation.ts`, and `app/(tabs)/_layout.tsx`. Besides them, a screen reads a colour from the theme only for a native prop NativeWind does not map from a class: `RefreshControl`'s spinner colours and the search field's text cursor (`selectionColor`). Everything else names a role in a class.

The catalog's files, written with `className` in artikel 06, get the same finish: `font-sans` on every outer `Text` and on the search field's `TextInput` (`app/(tabs)/index.tsx`, `SearchBar.tsx`, `ProductList.tsx`, `ProductListFooter.tsx`, `src/components/StatusMessage.tsx`), and icons coloured by a class instead of `useTheme()` (the sort button, the magnifier). The category chip's `×`, a text glyph that each font draws differently, is `Icon`'s `tutup` (Lucide's `x`).

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                     | Where to read it                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The font files and their license                            | `assets/fonts/` (`OFL.txt`)                                                                                                                          |
| The family name and the files, once                         | `src/theme/fonts.js`                                                                                                                                 |
| Fonts, app icon and splash in the native projects           | `app.config.ts` (`icon`, `android.adaptiveIcon`, `ios.icon`, the `expo-splash-screen` and `expo-font` plugins)                                       |
| `font-sans`, `font-mono`                                    | `tailwind.config.js`                                                                                                                                 |
| Inter in headers and the tab bar                            | `src/theme/navigation.ts`                                                                                                                            |
| Every icon, its drawing, and NativeWind on `Svg`            | `src/components/Icon.tsx`                                                                                                                            |
| The mark and the images drawn from it                       | `assets/brand/render.sh`, `assets/brand/goshop-mark.svg`                                                                                             |
| Screens in NativeWind, `useTheme()` only for the navigators | `app/filter.tsx`, `app/+not-found.tsx`, `app/produk/[slug].tsx`, `src/components/ScreenPlaceholder.tsx`; `app/_layout.tsx`, `app/(tabs)/_layout.tsx` |
| The catalog with Inter and icon classes, the chip's `tutup` | `app/(tabs)/index.tsx`, `src/features/catalog/components/SearchBar.tsx`, `src/features/catalog/components/ProductList.tsx`                           |

## Berbagi kode dengan web: types, API client, Zod schema di package bersama (artikel 12)

The app depends on `@goshop/shared` (`"workspace:*"` in `package.json`, added in artikel 03 for the `Product` type) and now uses it the way `apps/web` and `apps/admin` do: one API client built with `createApiClient` (`src/lib/api.ts`), the endpoint functions and the types generated from `api/openapi.yaml`, and the same Zod schemas. The first real user is the catalog's product list (`src/features/catalog/api/products.ts`), which the catalog screen of artikel 06 pages through. Nothing in `packages/shared` asks which platform it runs on; the one place where the phone needs something the browser did not, the cookie policy, is an option the app passes, not a branch inside the package.

### The mental model

| Idea                                   | What it means                                                                                                                                                                                                                                                                                                                         | Go comparison                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Shared code is code with no host**   | `packages/shared` may use the language (ES2023) and the handful of web APIs every host the apps run on provides: `fetch`, `Headers`, `AbortController`, `URL`, `URLSearchParams`, `setTimeout`, `Intl.NumberFormat`, `DOMException`. Anything that only a browser has (`window`, `document`, storage, cookies, locks) stays in an app | A package that imports only the standard library, so it builds for every `GOOS`                     |
| **A platform difference is an option** | When the phone needs different behaviour, the package grows a parameter and each app passes its value (`credentials: "omit"` below). Shared code never checks `Platform.OS` or `typeof window`                                                                                                                                        | Dependency injection: pass the `http.Client` in, do not switch on `runtime.GOOS` inside the library |
| **The host fills in the globals**      | On the phone `fetch`, `URL`, `URLSearchParams` and `DOMException` are not Hermes built-ins: React Native and Expo install them before the app's code runs (`expo/src/winter/runtime.native.ts`, `react-native/Libraries/Core/setUpXHR.js`). The same names, a different implementation underneath                                     | The same `net/http` API over a different OS network stack                                           |
| **The session is per platform**        | The web keeps its refresh token in an `HttpOnly` cookie the browser manages (`webLogin`/`webRefresh`); the phone keeps the token pair from `login` in `expo-secure-store` and sends `Authorization: Bearer` (Bab 15). Both sit on the same `ApiClient` type                                                                           | Two `TokenSource` implementations behind one interface                                              |

### What was checked in `packages/shared`, and how

Every file was read for anything web-only, and each finding was checked against the versions this app ships (Expo SDK 58, React Native 0.88.1, Hermes V1 `hermes-v260318099.0.5`), not from memory.

| API the package uses or might use                                                                                                                             | On the phone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verdict                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `fetch` without `credentials` (every call but the web session's)                                                                                              | Expo replaces the global `fetch` with `expo/fetch` (`expo/src/winter/runtime.native.ts`, unless `EXPO_PUBLIC_USE_RN_FETCH`). It defaults to `credentials: "include"` and turns `"same-origin"` into `"include"` (`expo/src/winter/fetch/fetch.ts`), with a native cookie jar on both platforms (`NativeRequest.kt` disables it only when credentials is not `include`; `ExpoURLSessionTask.swift` likewise). The shared client's "left out means no cookie" was a browser assumption             | **Fixed**: the client option `credentials` |
| `webLogin`, `webRefresh`, `webLogout` (`credentials: "include"`, `X-GoShop-Client`)                                                                           | Would work technically (the native jar stores the cookie), but the cookie exists to hide the refresh token from page scripts, a threat a phone does not have; the app has a keystore. The calls stay in the package for the web and are simply not used here                                                                                                                                                                                                                                     | Web only, by design                        |
| `new DOMException(…)` (client timeout, `sleep`)                                                                                                               | Not a Hermes or React Native global (React Native's `src/private/webapis/errors/DOMException.js` is private); Expo installs one (`install('DOMException', …)` in `runtime.native.ts`). Works because this is an Expo app                                                                                                                                                                                                                                                                         | Works                                      |
| `AbortController`, `signal.reason`, `addEventListener("abort", …, { once })`                                                                                  | React Native 0.88 installs its own `AbortController`/`AbortSignal` (`src/private/webapis/dom/abort-api/`), which keeps `abort(reason)` (the client tells its own timeout from a cancel by that reason) and has `AbortSignal.timeout` and `AbortSignal.any`. The package uses neither static method                                                                                                                                                                                               | Works                                      |
| `new URL(baseUrl)`, `URLSearchParams`                                                                                                                         | Expo replaces React Native's partial `URL` with `whatwg-url-minimum` (WHATWG URL without IDNA). Run against the six base URLs and queries the package's tests use, it gives byte-for-byte what Node gives: `protocol`, `href` (a bare `?` kept), `+` for spaces, `%2F`, the TypeError for a bad URL                                                                                                                                                                                              | Works                                      |
| `Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })` (`formatRupiah`)                                               | Hermes has `Intl` on both platforms (Android through ICU in Java, iOS through Foundation). IDR has two minor digits; with only `maximumFractionDigits: 0` Hermes clamps the minimum to 0 instead of throwing, on Android (`NumberFormat.java`) and iOS (`PlatformIntlApple.mm`, "If mnfd is undefined, set mnfd to min(mnfdDefault, mxfd)"). The formatter is built when the module loads, so a RangeError here would have crashed the app at start                                              | Works; exact spacing on iOS not yet seen   |
| `formatToParts`, `Intl.DateTimeFormat` with `timeZone: "Asia/Jakarta"`                                                                                        | Not used by the package. Note for later screens: `NumberFormat.formatToParts` is unimplemented on iOS Hermes (`llvm_unreachable("formatToParts is unimplemented on Apple platforms")`); a time zone is accepted on iOS when `NSTimeZone` knows the name                                                                                                                                                                                                                                          | Not used                                   |
| `toLocaleString("id-ID")`, `normalize("NFKD")`, `/\p{Diacritic}/u` (product form, admin)                                                                      | Bundled but not called by the app. Hermes compiles the regular expression (the bytecode check below)                                                                                                                                                                                                                                                                                                                                                                                             | Compiles; admin only                       |
| Zod with `z.config({ jitless: true })`                                                                                                                        | `jitless` stops Zod from probing `new Function`, which the web needed for its CSP; on the phone it means the schemas never depend on runtime code generation either                                                                                                                                                                                                                                                                                                                              | Works                                      |
| `window`, `document`, `localStorage`, `sessionStorage`, `navigator.locks`, `TextDecoderStream`/streams, `structuredClone`, `crypto.randomUUID`, `EventSource` | None appears in `packages/shared/src`. They live in the apps: the refresh lock (`apps/web/src/features/auth/refresh-lock.ts`, `navigator.locks`), the idempotency key (`apps/web/src/features/checkout/hooks/usePlaceOrder.ts`, `crypto.randomUUID()`), the dashboard's event stream (`apps/admin/src/features/realtime/`). `placeOrder` takes the key as an argument, so the phone can bring its own (`expo-crypto`, Bab 16): neither Hermes, React Native nor Expo's runtime installs `crypto` | Nothing to fix                             |

The schemas were also run through the phone's toolchain: a temporary entry that calls `loginSchema`, `registerSchema` (a password of eight emoji, counted as eight characters), `addressSchema`, `toProductSlug` and the URL builder was bundled by Metro for Android and for iOS, the bundles were executed in an empty JavaScript context (Node's V8, with nothing the bundle does not define but timers, `URL` and `Intl`), and their output compared with the same calls made from the package's own source in Node (the path `vitest` and the web use): identical for both platforms. Both bundles were then compiled to Hermes bytecode with the `hermesc` React Native 0.88.1 ships. What this cannot show is Hermes executing them; that happens the first time the catalog screen runs on the emulator and the simulator.

### Decisions

- **`credentials` is a client option, not a platform check.** `createApiClient({ credentials })` sets the cookie policy of every request the client sends; a request that names its own still wins (the web session calls keep `"include"`). Left out, the request carries no `credentials` at all and `fetch` decides, so the storefront and the dashboard behave exactly as before. The app passes `"omit"`: it sends a bearer token and never wants a cookie sent or stored, whatever a server might set.
- **One guest client, and a named seam for the token.** `api` is every request without a buyer. `authApi` is what the buyer's own endpoints (cart, orders, `/v1/me`) will use; today it is `api` itself, and Bab 15 replaces that one line with a client that adds `Authorization: Bearer` from `expo-secure-store`, the decorator `apps/web/src/features/auth/auth-client.ts` already is.
- **10 s per attempt and one retry**, not the web's 5 s and two. A phone on a cellular network can take seconds to wake its radio and reach the API; a request cut off just before its answer has to be waited for again. The worst case stays close to the web's: 10 + 0.3 + 10 ≈ 20 s against 3 × 5 + 0.9 ≈ 16 s.
- **Twenty products per page** (`CATALOG_PAGE_SIZE`): two columns of ten rows fill a tall screen with room for the next page to load before the buyer reaches the end. `ProductListFilters` is the API's query without the cursor, the same type the web's infinite query uses, because the cursor belongs to paging, not to the filters.
- **The package is imported from its TypeScript source**, as the web apps do. There is no build step for `packages/shared`: Metro transforms its `.ts` files with the app's Babel preset, so a change there reloads the app like a change to its own files.

### How Metro finds `@goshop/shared`

1. `pnpm install` links `apps/mobile/node_modules/@goshop/shared` to `packages/shared` (a symlink, as for every `workspace:*` dependency).
2. `expo/metro-config` detects the workspace and adds the repository's `node_modules` and every workspace package (including `packages/shared`) to `watchFolders`, so Metro may read files outside `apps/mobile` and watches them for Fast Refresh.
3. Package `exports` are on by default in this Metro (`resolver.unstable_enablePackageExports: true`): `"exports": { ".": "./src/index.ts" }` points the import at the source file, and Metro's `sourceExts` (`ts`, `tsx`, …) accept it. The relative imports inside (`./api/url.ts`) name an existing file and resolve as written.
4. Following the symlink to its real path, Metro looks up `zod` from `packages/shared/node_modules`, the package's own dependency; the app does not list `zod` itself.
5. `tsc` takes the same path for types: `allowImportingTsExtensions` in `tsconfig.json` (artikel 02) lets it follow those `.ts` imports.

### The rule for keeping `packages/shared` platform-neutral

Before adding anything to the package, ask whether it runs unchanged in a browser, in Node (the web's server components and the unit tests) and in Hermes inside Expo. If it reads `window` or `document`, stores anything, needs a cookie, a lock, a stream or a random ID, it belongs in the app that has that host; the shared function takes the result as an argument (as `placeOrder` takes the idempotency key) or the client takes it as an option (as `credentials`). Never `Platform.OS`, `typeof window` or `navigator.product` inside `packages/shared`: a branch like that is a platform the package's tests cannot see. New `Intl` features are checked against Hermes' supported list first (`formatToParts` is the trap on iOS).

### Where each idea lives

Paths are relative to `apps/mobile`; those starting with `packages/` or `apps/` are from the repository root.

| Concept                                         | Where to read it                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| The workspace dependency                        | `package.json` (`"@goshop/shared": "workspace:*"`)                        |
| The app's API clients and the Bab 15 token seam | `src/lib/api.ts`                                                          |
| The catalog's product list, for artikel 06      | `src/features/catalog/api/products.ts`                                    |
| The client option that sets the cookie policy   | `packages/shared/src/api/client.ts` (`ApiClientConfig.credentials`)       |
| The web session that stays web-only             | `packages/shared/src/api/auth.ts` (`webLogin`, `webRefresh`, `webLogout`) |
| The globals Expo installs on the phone          | `node_modules/expo/src/winter/runtime.native.ts`                          |
| The web's token decorator the seam will mirror  | `apps/web/src/features/auth/auth-client.ts`                               |

## Scaffold layar dengan AI lalu sesuaikan dengan pola proyek (artikel 14)

The Kategori tab replaces its placeholder with the real screen: every category from `GET /v1/categories` as a tree, top-level categories with their sub-categories indented under them, each row opening the catalog filtered by that category (`/?kategori=<slug>`, the storefront's word). The screen was scaffolded by an AI assistant and then adapted by hand, and the whole run is recorded in [`docs/ai-scaffold-kategori.md`](docs/ai-scaffold-kategori.md): the exact prompt, the raw output unedited, what the checks said about it, and every change with its reason, as `docs/ai-rules.md` requires.

### The method

1. **Prompt like a developer would.** The stack, the file, the endpoint with a sample response, where the result should lead. No repository conventions, on purpose: that is what a chat assistant usually gets, and it makes the gap visible.
2. **Keep the raw output.** Saved before anything is touched, so the article can show what the machine wrote and what the human changed.
3. **Run the project's checks on it first.** `tsc`, ESLint and Prettier on the raw file, unchanged: they find the mechanical problems (here 1 type error, 5 lint errors, formatting) before any reading starts.
4. **Read it against the project, not against "does it work".** For each piece ask: does the project already have this (client, types, tree builder)? Does it follow the project's patterns (TanStack Query, the feature folder, NativeWind roles, `Icon`)? Are the states, accessibility and navigation what the rest of the app does?
5. **Write down every change with its reason**, and what the AI got right. A change without a reason is taste; a reason without a change is a missed fix.

### The mental model

| Idea                                          | What it means                                                                                                                                                                                                                                                                   | Go comparison                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Works is not the same as fits**             | The raw screen fetched, built the tree, navigated and had loading, error and empty states. It still bypassed the app's API client (cookies, timeout, retry, error codes), copied a function the shared package already has, and ignored dark mode. None of that shows in a demo | A handler that returns 200 but opens its own `sql.DB` instead of taking the pool |
| **The model only knows what the prompt says** | It wrote its own `fetch`, types and tree builder because nothing said `@goshop/shared` exists. Most of the changes trace back to context the prompt did not carry, not to wrong code                                                                                            | Code review of a contributor who has never seen the repository                   |
| **The checks come before the reading**        | The type checker and the linter are cheap and find the mechanical issues; human review is for what tools cannot judge (does this duplicate something, is it the right behaviour)                                                                                                | `go vet` and `golangci-lint` before asking a reviewer                            |
| **The prompt is part of the result**          | "Tapping a sub-category opens the catalog" made the model leave top-level categories without a link: it followed the prompt exactly. A prompt is a spec, and its gaps become the code's gaps                                                                                    | A ticket's acceptance criteria                                                   |

### Decisions

- **TanStack Query, with the web's key and stale time, and one query for the whole app.** `categoriesQuery()` is `queryOptions` over `listCategories(api)`, keyed `["categories"]` and fresh for five minutes. It lives with the catalog's other keys in `src/features/catalog/api/queries.ts`, as on the web (`apps/web/src/features/catalog/api/queries.ts`), because Beranda reads the same cache entry for its category chip: one definition, so the two screens can never disagree on the key or on what the cache holds. The cache keeps the API's `Category[]`; the tree rows are built in `select` (`useCategoryRows`), so another screen can reshape the same data its own way. `@tanstack/react-query` comes from the workspace catalog (`"catalog:"`, 5.104.5), the same version as the web and the dashboard, rather than whatever `npx expo install` would pick: it has no native code, so Expo's SDK pinning has nothing to add, and one version across the repository keeps the query patterns identical. The `QueryClientProvider` at the root came with the catalog's product list (artikel 06).
- **Every category is a link, not only the leaves.** Filtering by a parent includes its sub-categories' products (the API's rule); the website links every node of its tree too. Otherwise a top-level category without children could not be opened at all.
- **Flat rows with a depth, not nested lists.** `flattenCategoryTree` turns the tree from `buildCategoryTree` into one row per category, so the FlatList recycles rows of one kind and a parent with many children is not one huge item. Depth becomes indentation, the one inline style (a number from the data, which no class can express).
- **`navigate` with `merge`, not `push`.** `/` is a tab: navigating switches to Beranda with `kategori` as its route parameter; `push` would not switch tabs. The call is React Navigation's, `navigation.navigate("index", { kategori }, { merge: true })` on the tab navigator (typed with the tabs' parameters), not `router.navigate({ pathname: "/", params: { kategori } })`: that one replaces Beranda's parameters, so a buyer who had searched `polos` sorted by the highest price lost both on choosing a category. With `merge` the search and the sort stay, as the storefront's category links keep them (`apps/web` `CategorySection`). Found in the chapter's native check; picking another category replaces `kategori`, the chip still clears only it.
- **A spinner only for the buyer's pull.** `refreshing` is a local flag set by the pull and cleared when `refetch()` settles, so a refetch TanStack Query starts on its own does not drag the list down. A refresh that fails keeps the old list and shows a note above it.
- **Offline is its own state, not a spinner.** With no network before the first load the categories query waits (`fetchStatus` `"paused"`, the online manager of artikel 06) instead of failing, and the screen used to show "Memuat kategori…" for as long as the phone stayed offline. `CategoryOffline` says "Tidak ada koneksi internet. Kategori dimuat begitu koneksi kembali.", Beranda's words, and the list loads by itself when the network returns. Found in the chapter's native check, once the online manager learned the state at start-up.
- **Errors worded by code, with the request ID.** The same sentences as `apps/web/src/lib/error-message.ts`, kept inside the feature for now; when a second screen needs them they move to `src/lib`.
- **A chevron on every row, through `Icon`.** The raw output drew a `›` character; the rows use `Icon`'s `lanjut` (Lucide's chevron-right, artikel 11) instead, coloured by a class, so it looks the same on both platforms and changes with the icon set in one file.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                      | Where to read it                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| The AI box: prompt, raw output, changes and why              | `docs/ai-scaffold-kategori.md`                                                                          |
| The route: which state to show, where a tap leads            | `app/(tabs)/kategori.tsx`                                                                               |
| `GET /v1/categories` as query options, shared with Beranda   | `src/features/catalog/api/queries.ts` (`categoriesQuery`)                                               |
| The tree as list rows (`buildCategoryTree` + flattening)     | `src/features/categories/hooks/useCategoryRows.ts`                                                      |
| The rows and their chevron, pull-to-refresh, the empty state | `src/features/categories/components/CategoryList.tsx`                                                   |
| Loading and error with "Coba lagi"                           | `src/features/categories/components/CategoryStatus.tsx`                                                 |
| The shared pieces it uses                                    | `packages/shared/src/api/catalog.ts` (`listCategories`), `packages/shared/src/catalog/category-tree.ts` |
| The rules the AI box follows                                 | `docs/ai-rules.md` (repository root)                                                                    |
