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

| Concern           | `apps/web` (Next.js) and `apps/admin` (Vite)                                                                                               | `apps/mobile` (Expo)                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components        | HTML elements: `<div>`, `<p>`, `<button>`, `<img>`, `<a>`                                                                                  | Core components: `<View>`, `<Text>`, `<Pressable>`, `<Image>`; links are `<Link>` from Expo Router. Every string must sit inside a `<Text>`: a bare string in a `<View>` is an error, not an anonymous text node (artikel 03)                                                |
| Styling           | Tailwind v4 classes compiled to CSS; the cascade, inheritance, media queries, units like `rem`                                             | JavaScript objects (`StyleSheet.create`), no cascade and no inheritance (except text inside text), numbers are density-independent pixels; Flexbox is the only layout and `flexDirection` defaults to `column` (artikel 04). NativeWind brings `className` back (artikel 05) |
| Lists             | `.map()` over an array; the browser handles thousands of rows                                                                              | `FlatList`/`FlashList` render only what is on screen, because every row is a real native view in memory (artikel 06 and 07)                                                                                                                                                  |
| Navigation        | The URL is the state: React Router (`apps/admin/src/app/routes.tsx`) or Next's App Router (`apps/web/src/app/`), the browser's back button | A stack of screens that slide in and out, tabs, modals, the system back gesture. Expo Router is file-based like Next's App Router (`app/index.tsx` is `/`), and `goshop://…` links map onto routes (artikel 08 and 09)                                                       |
| Screen edges      | The page scrolls inside a browser window                                                                                                   | Notches, the status bar, the home indicator and the keyboard cover parts of the screen; safe-area insets and keyboard avoidance are the app's job (artikel 10)                                                                                                               |
| Session storage   | The refresh token in an `HttpOnly` cookie no script can read, the access token in memory (ADR 0008, `packages/shared/src/api/auth.ts`)     | No cookie jar we control and no `HttpOnly`: the token pair from `POST /v1/auth/login` goes into the platform keystore through `expo-secure-store` (Keychain on iOS, Keystore-backed storage on Android), never AsyncStorage                                                  |
| Networking        | `fetch`, subject to CORS: the API lists the browser origins it allows (`APP_CORS_ALLOWED_ORIGINS`)                                         | The same `fetch`. CORS is a browser rule, so a native app is not subject to it. `localhost` is the device itself, so an emulator needs the host's address (artikel 02)                                                                                                       |
| Fonts and icons   | `@font-face`, SVG inline in JSX (`lucide-react`)                                                                                           | Fonts are loaded into the app (`expo-font`) before text that uses them renders; icons come from an icon font or `react-native-svg` (artikel 11)                                                                                                                              |
| Accessibility     | Semantic HTML plus `aria-*`                                                                                                                | `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, mapped to TalkBack and VoiceOver                                                                                                                                                                            |
| Dev loop          | Vite or Next dev server, hot module replacement, browser DevTools                                                                          | Metro bundler, Fast Refresh on the device, React Native DevTools (artikel 13)                                                                                                                                                                                                |
| Build and release | `pnpm build` → a Docker image (`apps/*/Dockerfile`) → Railway                                                                              | `eas build` → an `.apk`/`.aab` for Android and an `.ipa` (or a simulator build) for iOS → the stores. No Dockerfile, no Railway service: the app is not a container                                                                                                          |

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

| Concept                                         | Where to read it                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| The app's identity, platforms, plugins          | `app.config.ts`                                                                |
| Build profiles                                  | `eas.json`                                                                     |
| The API URL                                     | `src/config/env.ts`, `.env.example`                                            |
| The routes: the root stack and the first screen | `app/_layout.tsx`, `app/index.tsx`                                             |
| Bundler, types, lint                            | `metro.config.js`, `tsconfig.json`, `src/expo-types.d.ts`, `eslint.config.mjs` |
| What is generated and never committed           | `.gitignore` (`android/`, `ios/`, `.expo/`, `dist/`)                           |
