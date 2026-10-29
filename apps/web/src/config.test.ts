import { describe, expect, it, vi } from "vitest";

/** config.ts reads the environment once, when it is imported. */
const loadConfig = async () => {
  vi.resetModules();
  const { config } = await import("./config.ts");
  return config;
};

describe("config.apiUrl", () => {
  it("reads NEXT_PUBLIC_API_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");

    expect((await loadConfig()).apiUrl).toBe("https://api.example.com");
  });

  it("reads NEXT_PUBLIC_API_URL in a production build too", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");

    expect((await loadConfig()).apiUrl).toBe("https://api.example.com");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "falls back to localhost:8080 outside production when it is %s",
    async (_, value) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_API_URL", value);

      expect((await loadConfig()).apiUrl).toBe("http://localhost:8080");
    },
  );

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("throws in a production build when it is %s", async (_, value) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", value);

    await expect(loadConfig()).rejects.toThrow(
      "NEXT_PUBLIC_API_URL is not set",
    );
  });
});
