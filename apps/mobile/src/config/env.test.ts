import { afterEach, describe, expect, it, jest } from "@jest/globals";

// env.ts reads EXPO_PUBLIC_API_URL and Platform.OS once, when it loads, so
// every case loads a fresh copy (with its own react-native) after setting
// both. Under Metro the variable is inlined into the bundle at build time;
// Jest reads it from process.env, the same value as far as the code goes.
// jest.requireActual inside isolateModules loads from the isolated
// registry (babel-preset-expo leaves a dynamic import() as it is, which
// Jest cannot run without --experimental-vm-modules).
const loadApiUrl = (
  value: string | undefined,
  os: "android" | "ios" = "ios",
): string => {
  if (value === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = value;
  let apiUrl = "";
  jest.isolateModules(() => {
    const { Platform } =
      jest.requireActual<typeof import("react-native")>("react-native");
    jest.replaceProperty(Platform, "OS", os);
    ({ apiUrl } = jest.requireActual<typeof import("./env")>("./env"));
  });
  return apiUrl;
};

const original = process.env.EXPO_PUBLIC_API_URL;

afterEach(() => {
  jest.restoreAllMocks();
  if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = original;
});

describe("apiUrl", () => {
  it("is EXPO_PUBLIC_API_URL when it is set, on either platform", () => {
    expect(loadApiUrl("https://api.goshop.test", "ios")).toBe(
      "https://api.goshop.test",
    );
    expect(loadApiUrl("http://192.168.1.10:8080", "android")).toBe(
      "http://192.168.1.10:8080",
    );
  });

  it("drops every trailing slash, so paths join with exactly one", () => {
    expect(loadApiUrl("https://api.goshop.test/")).toBe(
      "https://api.goshop.test",
    );
    expect(loadApiUrl("https://api.goshop.test/v0///")).toBe(
      "https://api.goshop.test/v0",
    );
  });

  it("trims spaces around a set value", () => {
    expect(loadApiUrl("  https://api.goshop.test/ \n")).toBe(
      "https://api.goshop.test",
    );
  });

  it.each([
    ["unset", undefined],
    ["empty (EXPO_PUBLIC_API_URL= in .env)", ""],
    ["only spaces", "   "],
  ])(
    "%s means this machine: 10.0.2.2 on the Android emulator",
    (_name, value) => {
      expect(loadApiUrl(value, "android")).toBe("http://10.0.2.2:8080");
    },
  );

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["only spaces", " "],
  ])(
    "%s means this machine: localhost on the iOS simulator",
    (_name, value) => {
      expect(loadApiUrl(value, "ios")).toBe("http://localhost:8080");
    },
  );
});
