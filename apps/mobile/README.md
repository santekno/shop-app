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
| `EAS_BUILD_PROFILE`   | build | set by EAS                                                       | Which `eas.json` profile is being built; `app.config.ts` reads it                                                                                                                                                                                                     |

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

| Concept                                                 | Where to read it                                   |
| ------------------------------------------------------- | -------------------------------------------------- |
| The card: core components, pressed state, accessibility | `src/features/catalog/components/ProductCard.tsx`  |
| The photo: variants as a source list, the placeholder   | `src/features/catalog/components/ProductPhoto.tsx` |
| The sample products, in the API's shape                 | `src/features/catalog/fixtures.ts`                 |
| The screen that lists them and decides what a tap does  | `app/(tabs)/index.tsx`                             |

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

| Concept                                                              | Where to read it                                   |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| The grid: a wrapping row, `gap`, cell widths from the screen's width | `src/features/catalog/components/ProductGrid.tsx`  |
| The card's panel, text styles, pressed style, badge                  | `src/features/catalog/components/ProductCard.tsx`  |
| The square photo: `width: "100%"`, `aspectRatio`, `resizeMode`       | `src/features/catalog/components/ProductPhoto.tsx` |
| The screen's background and scrolling                                | `app/(tabs)/index.tsx`                             |

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
- **Reanimated comes with it.** NativeWind's runtime uses Reanimated for `transition-*` and `animate-*` classes, and `react-native-css-interop` declares it as a peer. It is a native module, so this is the first change since artikel 02 that needs a new development build (Expo Go already contains it). `babel-preset-expo` adds the worklets Babel plugin by itself when `react-native-worklets` is installed, so `babel.config.js` lists only NativeWind's additions.
- **Colours are the storefront's roles, with an explicit `dark:` twin.** `src/theme/colors.js` holds each role from `apps/web/src/index.css` (`background`, `card`, `primary`, `muted-foreground`, `destructive`, `border` …) with its light (`DEFAULT`) and dark value, so `bg-card` and `dark:bg-card-dark` are both generated. The web swaps CSS variables on `:root`, so its components never write `dark:`; here every colour class carries its `dark:` partner, which is longer to write but readable in place and needs nothing beyond the documented `darkMode: "media"`.
- **One colour file for classes and for code.** `src/theme/colors.js` is plain CommonJS because `tailwind.config.js` runs in Node and requires it; TypeScript reads it too (`allowJs` in Expo's base config). The navigation theme (`src/theme/navigation.ts`) uses it: Expo Router paints the header and the screen behind the content itself, in a light theme unless given one, so `app/_layout.tsx` wraps the stack in `<ThemeProvider>` with GoShop's colours for the current scheme.
- **`expo-system-ui`**, because `app.config.ts`'s `userInterfaceStyle: "automatic"` is only applied on Android with it installed (`expo prebuild` warned until it was), and it keeps the window behind the app in the right colour.
- **Restyled, not duplicated.** There is one `ProductCard`, now with `className`; the `StyleSheet` version stays in the artikel 04 section of this README, and the two side by side are below. `ProductGrid` stays a `StyleSheet` on purpose: its cell width is a number computed during render, which no class can express, and mixing `style` and `className` is normal.
- **Class names are written out in full.** Tailwind scans the files as text (`content`) and generates only the class names it finds. `"bg-" + role` is never generated; `ProductPhoto` keeps its shared classes in one constant string instead. Words in comments that happen to be class names (`grid`, `filter`) get generated too; they are unused and harmless.
- **No `prettier-plugin-tailwindcss`.** NativeWind's guide suggests it to sort class names; no other app in the repository sorts them, so neither does this one.

### StyleSheet and className, side by side

```tsx
// Artikel 04: StyleSheet (colours from a constant, light only)
<Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
//   card: { flex: 1, gap: 4, padding: 12, borderRadius: 8, borderWidth: 1,
//           borderColor: colors.border, backgroundColor: colors.card }

// Artikel 05: NativeWind (the storefront's classes, dark mode included)
<Pressable className="flex-1 gap-1 rounded-lg border border-border bg-card p-3 active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark">
```

Both end as the same style object on the native view. `StyleSheet` needs nothing installed and is checked by `tsc` property by property; `className` is shorter, shares its vocabulary with `apps/web`, and has the pressed and dark states built in, at the cost of a build step and a few dependencies.

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                                             | Where to read it                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Tailwind's configuration: files scanned, preset, colours, dark mode | `tailwind.config.js`                                                                          |
| GoShop's colour roles, light and dark                               | `src/theme/colors.js`                                                                         |
| NativeWind in the build: Metro, Babel, the input CSS, the types     | `metro.config.js`, `babel.config.js`, `global.css`, `nativewind-env.d.ts`                     |
| The CSS imported once; the navigation's colours per scheme          | `app/_layout.tsx`, `src/theme/navigation.ts`                                                  |
| The card, photo and screen with `className`                         | `src/features/catalog/components/ProductCard.tsx`, `ProductPhoto.tsx`, `app/(tabs)/index.tsx` |
| The one `StyleSheet` kept beside NativeWind                         | `src/features/catalog/components/ProductGrid.tsx`                                             |

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
- **The screen reads the parameter, the header shows it.** `[slug].tsx` sets its own title with `<Stack.Screen options={…} />` while it renders. The real screen fetches `GET /v1/products/{slug}` and shows the product's name; a slug the API does not know is a "not found" state of that screen, not `+not-found` (which is for paths that match no route at all).

### Where each idea lives

Paths are relative to `apps/mobile`.

| Concept                                   | Where to read it                                 |
| ----------------------------------------- | ------------------------------------------------ |
| The scheme and typed routes               | `app.config.ts` (`scheme`, `experiments`)        |
| The root stack and its screens            | `app/_layout.tsx`                                |
| The tab group                             | `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx` |
| A dynamic route and its parameter         | `app/produk/[slug].tsx`                          |
| Paths that match nothing                  | `app/+not-found.tsx`                             |
| Route type generation in `pnpm typecheck` | `package.json` (`typecheck`), `tsconfig.json`    |

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

| Concept                                   | Where to read it                                                    |
| ----------------------------------------- | ------------------------------------------------------------------- |
| The root stack: tabs, push, modal         | `app/_layout.tsx`                                                   |
| The tab bar and its icons                 | `app/(tabs)/_layout.tsx`                                            |
| The four tabs                             | `app/(tabs)/index.tsx`, `kategori.tsx`, `keranjang.tsx`, `akun.tsx` |
| The modal and how it returns a choice     | `app/filter.tsx`                                                    |
| Sort orders and reading them from a route | `src/features/catalog/sort-options.ts`                              |
| Icons                                     | `src/components/Icon.tsx`                                           |
| A screen whose feature comes later        | `src/components/ScreenPlaceholder.tsx`                              |

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

| Concept                                         | Where to read it                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| The workspace dependency                        | `package.json` (`"@goshop/shared": "workspace:*"`)                        |
| The app's API clients and the Bab 15 token seam | `src/lib/api.ts`                                                          |
| The catalog's product list, for artikel 06      | `src/features/catalog/api/products.ts`                                    |
| The client option that sets the cookie policy   | `packages/shared/src/api/client.ts` (`ApiClientConfig.credentials`)       |
| The web session that stays web-only             | `packages/shared/src/api/auth.ts` (`webLogin`, `webRefresh`, `webLogout`) |
| The globals Expo installs on the phone          | `node_modules/expo/src/winter/runtime.native.ts`                          |
| The web's token decorator the seam will mirror  | `apps/web/src/features/auth/auth-client.ts`                               |
