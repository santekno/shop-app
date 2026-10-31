import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { ExpoConfig } from "expo/config";

// app.config.ts runs in Node for every Expo command and EAS build, and
// decides from the environment which profile it is for. Each case loads a
// fresh copy after setting the three variables it reads.
interface BuildEnv {
  EAS_BUILD_PROFILE?: string;
  APP_VARIANT?: string;
  EXPO_PUBLIC_API_URL?: string;
}

const NAMES = [
  "EAS_BUILD_PROFILE",
  "APP_VARIANT",
  "EXPO_PUBLIC_API_URL",
] as const;
const saved = Object.fromEntries(
  NAMES.map((name) => [name, process.env[name]]),
);

const loadConfig = (env: BuildEnv): ExpoConfig => {
  for (const name of NAMES) {
    const value = env[name];
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  let config: ExpoConfig | undefined;
  jest.isolateModules(() => {
    config = jest.requireActual<{ default: ExpoConfig }>(
      "./app.config",
    ).default;
  });
  if (config === undefined) throw new Error("app.config.ts exported nothing");
  return config;
};

afterEach(() => {
  for (const name of NAMES) {
    const value = saved[name];
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

/** The options a config plugin was given, by the plugin's name. */
const pluginOptions = (config: ExpoConfig, name: string): unknown => {
  const entry = config.plugins?.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name,
  );
  if (entry === undefined) throw new Error(`no plugin ${name}`);
  return Array.isArray(entry) ? entry[1] : undefined;
};

const cleartext = (config: ExpoConfig): unknown =>
  (
    pluginOptions(config, "expo-build-properties") as {
      android: { usesCleartextTraffic: unknown };
    }
  ).android.usesCleartextTraffic;

const PRODUCTION_ATS = {
  NSAppTransportSecurity: {
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: false,
  },
};

describe("the production guard", () => {
  it.each([
    ["EAS_BUILD_PROFILE", { EAS_BUILD_PROFILE: "production" }],
    ["APP_VARIANT", { APP_VARIANT: "production" }],
  ])(
    "refuses a production build (%s) without EXPO_PUBLIC_API_URL",
    (_name, env) => {
      expect(() => loadConfig(env)).toThrow(
        "EXPO_PUBLIC_API_URL must be set for a production build",
      );
      expect(() => loadConfig({ ...env, EXPO_PUBLIC_API_URL: "" })).toThrow(
        "EXPO_PUBLIC_API_URL must be set",
      );
    },
  );

  it("builds production when the URL is set", () => {
    const config = loadConfig({
      EAS_BUILD_PROFILE: "production",
      EXPO_PUBLIC_API_URL: "https://api.goshop.test",
    });
    expect(config.name).toBe("GoShop");
  });

  it.each([
    ["preview", { EAS_BUILD_PROFILE: "preview" }],
    ["development", { EAS_BUILD_PROFILE: "development" }],
    ["no profile (expo start)", {}],
  ])("lets %s build without the URL (the local fallback)", (_name, env) => {
    expect(loadConfig(env).slug).toBe("goshop");
  });

  it("EAS_BUILD_PROFILE wins over APP_VARIANT", () => {
    // EAS sets the profile; a stray APP_VARIANT=production in the shell
    // must not make a preview build demand the production URL.
    expect(() =>
      loadConfig({ EAS_BUILD_PROFILE: "preview", APP_VARIANT: "production" }),
    ).not.toThrow();
    expect(() =>
      loadConfig({ EAS_BUILD_PROFILE: "production", APP_VARIANT: "preview" }),
    ).toThrow("EXPO_PUBLIC_API_URL must be set");
  });
});

describe("plain http and App Transport Security per profile", () => {
  it.each([
    ["preview", { EAS_BUILD_PROFILE: "preview" }],
    ["development", { EAS_BUILD_PROFILE: "development" }],
    ["no profile", {}],
    ["APP_VARIANT=preview", { APP_VARIANT: "preview" }],
  ])(
    "%s allows cleartext on Android and keeps Expo's ATS on iOS",
    (_name, env) => {
      const config = loadConfig(env);
      expect(cleartext(config)).toBe(true);
      expect(config.ios?.infoPlist).toBeUndefined();
    },
  );

  it.each([
    ["EAS_BUILD_PROFILE", { EAS_BUILD_PROFILE: "production" }],
    ["APP_VARIANT", { APP_VARIANT: "production" }],
  ])(
    "production (%s) refuses cleartext and every ATS exception",
    (_name, env) => {
      const config = loadConfig({
        ...env,
        EXPO_PUBLIC_API_URL: "https://api.goshop.test",
      });
      // false, not absent: on Android 7–8 (minSdk 24) absent means allowed.
      expect(cleartext(config)).toBe(false);
      expect(config.ios?.infoPlist).toEqual(PRODUCTION_ATS);
    },
  );
});

describe("the app's identity", () => {
  const config = () => loadConfig({});

  it("uses one identifier for both stores, the goshop scheme, native targets only", () => {
    const { android, ios, scheme, platforms } = config();
    expect(android?.package).toBe("com.santekno.goshop");
    expect(ios?.bundleIdentifier).toBe("com.santekno.goshop");
    expect(scheme).toBe("goshop");
    expect(platforms).toEqual(["android", "ios"]);
    expect(ios?.supportsTablet).toBe(false);
  });

  it("follows the device's light or dark setting and has typed routes", () => {
    expect(config().userInterfaceStyle).toBe("automatic");
    expect(config().experiments?.typedRoutes).toBe(true);
  });

  it("paints the adaptive icon and the splash in the theme's colours", () => {
    const { android } = config();
    expect(android?.adaptiveIcon?.backgroundColor).toBe("#0b5cad");
    expect(pluginOptions(config(), "expo-splash-screen")).toMatchObject({
      backgroundColor: "#f6f8fa",
      dark: { backgroundColor: "#0d1117" },
    });
  });

  it("embeds the four Inter files: one family with a weight each on Android", () => {
    const fonts = pluginOptions(config(), "expo-font") as {
      ios: { fonts: string[] };
      android: {
        fonts: {
          fontFamily: string;
          fontDefinitions: { path: string; weight: number }[];
        }[];
      };
    };
    expect(fonts.ios.fonts).toEqual([
      "./assets/fonts/Inter-Regular.ttf",
      "./assets/fonts/Inter-Medium.ttf",
      "./assets/fonts/Inter-SemiBold.ttf",
      "./assets/fonts/Inter-Bold.ttf",
    ]);
    expect(fonts.android.fonts).toEqual([
      {
        fontFamily: "Inter",
        fontDefinitions: [
          { path: "./assets/fonts/Inter-Regular.ttf", weight: 400 },
          { path: "./assets/fonts/Inter-Medium.ttf", weight: 500 },
          { path: "./assets/fonts/Inter-SemiBold.ttf", weight: 600 },
          { path: "./assets/fonts/Inter-Bold.ttf", weight: 700 },
        ],
      },
    ]);
  });

  it("registers the router and status bar plugins", () => {
    expect(config().plugins).toEqual(
      expect.arrayContaining(["expo-router", "expo-status-bar"]),
    );
  });
});
