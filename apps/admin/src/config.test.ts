import { afterEach, describe, expect, it, vi } from "vitest";

const loadConfig = async () => (await import("./config.ts")).config;

afterEach(() => {
  vi.resetModules();
});

describe("config.apiUrl", () => {
  it("is VITE_API_URL when it is set", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.goshop.test");

    expect((await loadConfig()).apiUrl).toBe("https://api.goshop.test");
  });

  it("falls back to the local API in development", async () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("DEV", true);

    expect((await loadConfig()).apiUrl).toBe("http://localhost:8080");
  });

  it("refuses to start without one outside development", async () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("DEV", false);

    await expect(loadConfig()).rejects.toThrow("VITE_API_URL is not set");
  });
});
