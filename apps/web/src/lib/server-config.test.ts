// The storefront server's settings, read from its environment when it runs
// (Bab 11 artikel 08–13). vi.stubEnv lasts for one test (vite.config.ts:
// unstubEnvs).
import { describe, expect, it, vi } from "vitest";
import { analyticsId, imageOrigin, siteUrl } from "./server-config.ts";

describe("serverConfig.apiUrl", () => {
  // Read once, when the module loads: each case loads a fresh copy.
  const loadApiUrl = async () => {
    vi.resetModules();
    return (await import("./server-config.ts")).serverConfig.apiUrl;
  };

  it("is API_INTERNAL_URL when it is set, the address inside the network", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    vi.stubEnv("API_INTERNAL_URL", "http://api:8080");

    await expect(loadApiUrl()).resolves.toBe("http://api:8080");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "falls back to the public API URL when API_INTERNAL_URL is %s",
    async (_, value) => {
      vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
      vi.stubEnv("API_INTERNAL_URL", value);

      await expect(loadApiUrl()).resolves.toBe("https://api.example.com");
    },
  );
});

describe("siteUrl", () => {
  it("is SITE_URL as a URL when it is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "https://shop.example.com");

    expect(siteUrl().href).toBe("https://shop.example.com/");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "is the dev server's origin outside production when SITE_URL is %s",
    (_, value) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SITE_URL", value);

      expect(siteUrl().href).toBe("http://localhost:5173/");
    },
  );

  it("fails in production when SITE_URL is not set, instead of naming localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "");

    expect(() => siteUrl()).toThrow(/^SITE_URL is not set/);
  });

  it("fails on a SITE_URL that is not a URL", () => {
    vi.stubEnv("SITE_URL", "shop.example.com");

    expect(() => siteUrl()).toThrow(TypeError);
  });
});

describe("imageOrigin", () => {
  it("is only the origin of IMAGE_ORIGIN, without a path", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IMAGE_ORIGIN", "https://img.example.com:8443/goshop/products");

    expect(imageOrigin()).toBe("https://img.example.com:8443");
  });

  it("is the local image storage in development when unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("IMAGE_ORIGIN", "");

    expect(imageOrigin()).toBe("http://localhost:8333");
  });

  it("is undefined in production when unset: no image host is allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IMAGE_ORIGIN", undefined);

    expect(imageOrigin()).toBeUndefined();
  });

  it("fails loudly on a value that is not a URL", () => {
    vi.stubEnv("IMAGE_ORIGIN", "img.example.com");

    expect(() => imageOrigin()).toThrow(TypeError);
  });
});

describe("analyticsId", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])(
    "is undefined (analytics off) when GA_MEASUREMENT_ID is %s",
    (_, value) => {
      vi.stubEnv("GA_MEASUREMENT_ID", value);

      expect(analyticsId()).toBeUndefined();
    },
  );

  it("is the measurement ID, trimmed", () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "  G-TEST123456\n");

    expect(analyticsId()).toBe("G-TEST123456");
  });

  it.each([
    ["the shortest", "G-AB12"],
    ["the longest", `G-${"A".repeat(20)}`],
  ])("accepts %s ID", (_, value) => {
    vi.stubEnv("GA_MEASUREMENT_ID", value);

    expect(analyticsId()).toBe(value);
  });

  it.each([
    ["a Universal Analytics ID", "UA-12345-1"],
    ["lower case", "g-test123456"],
    ["too short", "G-ABC"],
    ["too long", `G-${"A".repeat(21)}`],
    ["markup", 'G-TEST");alert(1);("'],
    ["a prefix of a valid ID", "xG-TEST123456"],
  ])("throws on %s instead of printing it into a script", (_, value) => {
    vi.stubEnv("GA_MEASUREMENT_ID", value);

    expect(() => analyticsId()).toThrow(
      `GA_MEASUREMENT_ID is not a GA4 measurement ID (G-XXXXXXXXXX): ${JSON.stringify(value)}`,
    );
  });
});
