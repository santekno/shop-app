import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { listCategories } from "@goshop/shared";

import { apiError, fakeApi, json, networkDown } from "@/test/fake-api";
import { api, authApi } from "./api";

afterEach(() => {
  jest.useRealTimers();
});

describe("api: the guest client", () => {
  it("calls the API at apiUrl and never sends or keeps a cookie", async () => {
    fakeApi.on("GET", "/v1/categories", () => json({ data: [] }));

    await expect(listCategories(api)).resolves.toEqual([]);

    const [request] = fakeApi.requests();
    // jest-expo runs as iOS with EXPO_PUBLIC_API_URL unset.
    expect(request?.url.origin).toBe("http://localhost:8080");
    // Expo's fetch defaults to "include" with a native cookie jar.
    expect(request?.init.credentials).toBe("omit");
    expect(new Headers(request?.init.headers).get("Accept")).toBe(
      "application/json",
    );
  });

  it("tries a GET once more after a network failure", async () => {
    fakeApi.once("GET", "/v1/categories", networkDown);
    fakeApi.once("GET", "/v1/categories", () => json({ data: [] }));

    await expect(listCategories(api)).resolves.toEqual([]);
    expect(fakeApi.requests()).toHaveLength(2);
  });

  it("tries only once more: two 503s are the error", async () => {
    fakeApi.on("GET", "/v1/categories", () =>
      apiError(503, "UNAVAILABLE", "r-1"),
    );

    await expect(listCategories(api)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      requestId: "r-1",
    });
    expect(fakeApi.requests()).toHaveLength(2);
  });

  it("does not retry an answer that will not change (a 400)", async () => {
    fakeApi.on("GET", "/v1/categories", () =>
      apiError(400, "VALIDATION_FAILED"),
    );

    await expect(listCategories(api)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(fakeApi.requests()).toHaveLength(1);
  });

  it("gives an attempt 10 s, not the web's 5", async () => {
    jest.useFakeTimers();
    fakeApi.on(
      "GET",
      "/v1/categories",
      () => new Promise<Response>(() => undefined),
    );

    const failure = listCategories(api).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(9_999);
    expect(fakeApi.requests()).toHaveLength(1);
    expect(fakeApi.requests()[0]?.init.signal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(fakeApi.requests()[0]?.init.signal?.aborted).toBe(true);
    // Then 300 ms, then the second and last 10 s attempt.
    await jest.advanceTimersByTimeAsync(300 + 10_000);
    expect(fakeApi.requests()).toHaveLength(2);
    await expect(failure).resolves.toMatchObject({ code: "CLIENT_TIMEOUT" });
  });

  it("is also the buyer's client until sign-in arrives", () => {
    expect(authApi).toBe(api);
  });
});
