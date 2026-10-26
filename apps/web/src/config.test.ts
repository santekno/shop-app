import { describe, expect, it, vi } from "vitest";

/** config.ts reads the environment once, when it is imported. */
const loadConfig = async () => {
  vi.resetModules();
  const { config } = await import("./config.ts");
  return config;
};

describe("config.apiUrl", () => {
  it("reads VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");

    expect((await loadConfig()).apiUrl).toBe("https://api.example.com");
  });

  it("reads VITE_API_URL outside the dev server too", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_URL", "https://api.example.com");

    expect((await loadConfig()).apiUrl).toBe("https://api.example.com");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "falls back to localhost:8080 on the dev server when it is %s",
    async (_, value) => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_API_URL", value);

      expect((await loadConfig()).apiUrl).toBe("http://localhost:8080");
    },
  );

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("throws outside the dev server when it is %s", async (_, value) => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_URL", value);

    await expect(loadConfig()).rejects.toThrow("VITE_API_URL is not set");
  });
});
