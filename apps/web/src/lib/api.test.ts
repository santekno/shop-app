import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/api.ts creates its client when it is imported, with the global fetch
// and the configured URL, so both are in place before the import below
// (vi.hoisted runs before imports).
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", mock);
  vi.stubEnv("VITE_API_URL", "https://api.example.com");
  return mock;
});

import { api } from "./api.ts";

const unavailable = () =>
  Response.json(
    { error: { code: "INTERNAL_ERROR", message: "down" } },
    { status: 503 },
  );

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the storefront's API client", () => {
  it("sends requests to VITE_API_URL", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [] }));

    await api.request("/v1/categories");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.com/v1/categories",
    );
  });

  it("retries a GET twice, after 300 ms and then 600 ms", async () => {
    fetchMock
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const result = api.request("/v1/categories");
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(599);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the third attempt", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(unavailable()));

    const result = api.request("/v1/categories").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await result).toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times an attempt out after 5 seconds, half the shared default", async () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    const result = api
      .request("/v1/categories", { retries: 0 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toMatchObject({
      code: "CLIENT_TIMEOUT",
      message: "the API did not answer within 5000 ms",
    });
  });
});
