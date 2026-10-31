// The app's identity and native configuration, read by every Expo command
// (start, prebuild, export) and by EAS Build. It is TypeScript rather than
// app.json so it can read the environment: EAS sets EAS_BUILD_PROFILE to the
// eas.json profile being built.
//
// android/ and ios/ are generated from this file by `npx expo prebuild`
// (Continuous Native Generation) and are not committed: a native setting
// lives here or in a config plugin, never in a hand-edited Gradle or Xcode
// file.
import type { ExpoConfig } from "expo/config";

// One identifier for both stores. Changing it after the first release makes
// a different app as far as Google Play and the App Store are concerned.
const APP_ID = "com.santekno.goshop";

// Which eas.json profile this configuration is for. EAS sets
// EAS_BUILD_PROFILE on every build it runs (in the cloud or with --local);
// APP_VARIANT names one for a command run by hand, such as
// `APP_VARIANT=production npx expo prebuild`. Neither set means a developer's
// machine (expo start, expo run:android).
const buildProfile =
  process.env.EAS_BUILD_PROFILE ?? process.env.APP_VARIANT ?? "development";
const isProduction = buildProfile === "production";

// The API URL itself is read in one place, src/config/env.ts. Here we only
// refuse to build a store release that would quietly talk to a developer's
// machine (the fallback in env.ts).
if (isProduction && !process.env.EXPO_PUBLIC_API_URL) {
  throw new Error(
    "EXPO_PUBLIC_API_URL must be set for a production build (an EAS environment variable or eas.json's env)",
  );
}

const config: ExpoConfig = {
  name: "GoShop",
  slug: "goshop",
  version: "1.0.0",
  // goshop://… links open the app (Expo Router turns them into routes).
  scheme: "goshop",
  // Native targets only: there is a web storefront already (apps/web).
  platforms: ["android", "ios"],
  orientation: "portrait",
  // Light or dark follows the device setting.
  userInterfaceStyle: "automatic",
  android: {
    package: APP_ID,
  },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    // App Transport Security: HTTPS only, except for "local" hosts. Expo's
    // template allows those in every build (NSAllowsLocalNetworking), which
    // is how a development or preview build on the simulator reaches
    // http://localhost:8080. A store build talks to the public HTTPS API
    // only, so production turns the exception off.
    infoPlist: isProduction
      ? {
          NSAppTransportSecurity: {
            NSAllowsArbitraryLoads: false,
            NSAllowsLocalNetworking: false,
          },
        }
      : undefined,
  },
  plugins: [
    "expo-router",
    "expo-status-bar",
    [
      "expo-build-properties",
      {
        android: {
          // Plain http:// (cleartext). Android blocks it from version 9 on,
          // except in a debug build, which Expo's template allows; a
          // preview APK is a release build, so without this it could not
          // reach http://10.0.2.2:8080. Production says "no" explicitly:
          // the app supports Android 7 (minSdk 24), where leaving it out
          // would mean "allowed".
          usesCleartextTraffic: !isProduction,
        },
      },
    ],
  ],
  experiments: {
    // `expo start` writes .expo/types/router.d.ts from the files in app/,
    // so an href or a route parameter that does not exist fails tsc.
    typedRoutes: true,
  },
};

export default config;
