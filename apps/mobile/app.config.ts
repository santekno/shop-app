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

// The API URL itself is read in one place, src/config/env.ts. Here we only
// refuse to build a store release that would quietly talk to a developer's
// machine (the fallback in env.ts).
if (
  process.env.EAS_BUILD_PROFILE === "production" &&
  !process.env.EXPO_PUBLIC_API_URL
) {
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
  },
  plugins: ["expo-router", "expo-status-bar"],
  experiments: {
    // `expo start` writes .expo/types/router.d.ts from the files in app/,
    // so an href or a route parameter that does not exist fails tsc.
    typedRoutes: true,
  },
};

export default config;
