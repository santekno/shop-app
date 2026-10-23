import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.ts";
import type { ApiClientOptions } from "./client.ts";
import { ApiError } from "./errors.ts";

const BASE = "http://api.test";

/** A JSON response, the way the API sends one. */
const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A response whose body is not JSON, such as a proxy's 502 page. */
const text = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
) => new Response(body, { status, headers });

const errorBody = (code: string, message = "boom") => ({
  error: { code, message },
});

/**
 * A fetch that never answers on its own and rejects with the signal's reason
 * when the signal aborts, as the real fetch does.
 */
const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

/** A 200 whose headers arrive but whose body stalls until the signal aborts. */
const stallingBodyFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
  Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          init?.signal?.addEventListener("abort", () => {
            controller.error(init.signal?.reason);
          });
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

const setup = (options: Partial<ApiClientOptions> = {}) => {
  const fetchMock = vi.fn<typeof fetch>();
  const api = createApiClient({ baseUrl: BASE, fetch: fetchMock, ...options });
  return { api, fetchMock };
};

/** The URL and init of the nth fetch call. */
const callOf = (fetchMock: ReturnType<typeof setup>["fetchMock"], n = 0) => {
  const call = fetchMock.mock.calls[n];
  if (!call) throw new Error(`fetch was not called ${n + 1} times`);
  const [input, init = {}] = call;
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return { url, init, headers: new Headers(init.headers) };
};

/** The error a promise rejects with, or a failure when it resolves. */
const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createApiClient", () => {
  it("rejects an invalid base URL when the client is created", () => {
    expect(() => createApiClient({ baseUrl: "ftp://api.test" })).toThrow(
      TypeError,
    );
  });

  it("uses the global fetch when none is given", async () => {
    const globalFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(json(200, { ok: true })),
    );
    vi.stubGlobal("fetch", globalFetch);

    const api = createApiClient({ baseUrl: BASE });

    await expect(api.request("/v1/ping")).resolves.toEqual({ ok: true });
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it("calls the injected fetch unbound, never as a method of the options", async () => {
    const receivers: unknown[] = [];
    const options: ApiClientOptions = {
      baseUrl: BASE,
      fetch: function (this: unknown) {
        receivers.push(this);
        return Promise.resolve(json(200, {}));
      },
    };

    await createApiClient(options).request("/v1/ping");

    expect(receivers).toEqual([undefined]);
  });
});

describe("request: the outgoing call", () => {
  it("joins the base URL, the path and the query", async () => {
    const { api, fetchMock } = setup({ baseUrl: `${BASE}/base/` });
    fetchMock.mockResolvedValue(json(200, {}));

    await api.request("/v1/products", {
      query: { category: "kaos polos", page: 0, cursor: null, q: undefined },
    });

    expect(callOf(fetchMock).url).toBe(
      `${BASE}/base/v1/products?category=kaos+polos&page=0`,
    );
  });

  it("sends a GET with Accept and without Content-Type or a body by default", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(json(200, {}));

    await api.request("/v1/categories");

    const { init, headers } = callOf(fetchMock);
    expect(init.method).toBe("GET");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.has("Content-Type")).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it("sends a body as JSON with a Content-Type", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(json(201, { id: "1" }));

    await api.request("/v1/cart/items", {
      method: "POST",
      body: { product_id: "p1", quantity: 0, gift: false },
    });

    const { init, headers } = callOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    expect(init.body).toBe('{"product_id":"p1","quantity":0,"gift":false}');
  });

  it("keeps the caller's Accept and other headers", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(json(200, {}));

    await api.request("/v1/x", {
      headers: { Accept: "application/problem+json", "X-Trace": "t-1" },
    });

    const { headers } = callOf(fetchMock);
    expect(headers.get("Accept")).toBe("application/problem+json");
    expect(headers.get("X-Trace")).toBe("t-1");
  });
  it("accepts only the HTTP methods the API uses", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(json(200, {}));

    // @ts-expect-error OPTIONS is not an HttpMethod
    await api.request("/v1/x", { method: "OPTIONS" });

    expect(callOf(fetchMock).init.method).toBe("OPTIONS");
  });
});

describe("request: reading the response", () => {
  it("returns the parsed JSON of a 2xx response", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(json(200, { data: [1, 2] }));

    await expect(api.request("/v1/x")).resolves.toEqual({ data: [1, 2] });
  });

  it.each([
    ["a 204", () => new Response(null, { status: 204 })],
    ["a 200 with an empty body", () => text(200, "")],
  ])("returns undefined for %s", async (_, response) => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(response());

    await expect(api.request("/v1/x")).resolves.toBeUndefined();
  });

  it("returns a JSON null or false as it is", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(text(200, "null"));
    fetchMock.mockResolvedValueOnce(text(200, "false"));

    await expect(api.request("/v1/x")).resolves.toBeNull();
    await expect(api.request("/v1/x")).resolves.toBe(false);
  });

  it("fails a 2xx that is not JSON with INVALID_RESPONSE", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(
      text(200, "<html>hi</html>", { "X-Request-ID": "req-html" }),
    );

    const error = await failure(api.request("/v1/x"));
    expect(error).toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
      message: "unexpected response from the API (HTTP 200)",
      requestId: "req-html",
    });
  });

  it("maps an error body to an ApiError with the request ID", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(
      json(
        422,
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "name is required",
            details: { fields: { name: "required" } },
          },
        },
        { "X-Request-ID": "req-42" },
      ),
    );

    const error = await failure(api.request("/v1/x"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "ApiError",
      status: 422,
      code: "VALIDATION_FAILED",
      message: "name is required",
      details: { fields: { name: "required" } },
      requestId: "req-42",
    });
  });

  it("gives an error body without details empty details and no request ID", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(json(404, errorBody("NOT_FOUND", "no such")));

    const error = await failure(api.request("/v1/x"));
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.details).toEqual({});
    expect(error.requestId).toBeUndefined();
  });

  it.each([
    ["an HTML 502 page", text(502, "<html>Bad Gateway</html>")],
    ["a JSON body that is not an error body", json(500, { message: "x" })],
    ["an empty 500", text(500, "")],
  ])("fails %s with INVALID_RESPONSE and the real status", async (_, res) => {
    const { api, fetchMock } = setup();
    res.headers.set("X-Request-ID", "req-gw");
    fetchMock.mockResolvedValue(res);

    const error = await failure(api.request("/v1/x"));
    expect(error).toMatchObject({
      status: res.status,
      code: "INVALID_RESPONSE",
      message: `unexpected response from the API (HTTP ${res.status})`,
      requestId: "req-gw",
    });
  });
});

describe("request: timeouts", () => {
  it("fails with CLIENT_TIMEOUT when no headers arrive in time", async () => {
    const { api, fetchMock } = setup({ timeoutMs: 1_000 });
    fetchMock.mockImplementation(hangingFetch);

    const result = failure(api.request("/v1/x"));
    await vi.advanceTimersByTimeAsync(999);
    expect(callOf(fetchMock).init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const error = await result;
    expect(error).toMatchObject({
      status: 0,
      code: "CLIENT_TIMEOUT",
      message: "the API did not answer within 1000 ms",
    });
    expect(error.cause).toMatchObject({ name: "TimeoutError" });
  });

  it("fails with CLIENT_TIMEOUT when the body stalls after the headers", async () => {
    const { api, fetchMock } = setup({ timeoutMs: 500 });
    fetchMock.mockImplementation(stallingBodyFetch);

    const result = failure(api.request("/v1/x"));
    await vi.advanceTimersByTimeAsync(500);

    expect((await result).code).toBe("CLIENT_TIMEOUT");
  });

  it("clears its timer once the response is read", async () => {
    const { api, fetchMock } = setup({ timeoutMs: 1_000 });
    fetchMock.mockResolvedValue(json(200, {}));

    await api.request("/v1/x");

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("request: cancelling and network failures", () => {
  it("fails with ABORTED when the caller's signal is already aborted", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockImplementation(hangingFetch);
    const controller = new AbortController();
    const reason = new Error("left the page");
    controller.abort(reason);

    const error = await failure(
      api.request("/v1/x", { signal: controller.signal }),
    );
    expect(error).toMatchObject({ status: 0, code: "ABORTED" });
    expect(error.cause).toBe(reason);
    expect(callOf(fetchMock).init.signal?.aborted).toBe(true);
    expect(callOf(fetchMock).init.signal?.reason).toBe(reason);
  });

  it("fails with ABORTED when the caller aborts during the request", async () => {
    const { api, fetchMock } = setup({ timeoutMs: 1_000 });
    fetchMock.mockImplementation(hangingFetch);
    const controller = new AbortController();

    const reason = new Error("left the page");

    const result = failure(api.request("/v1/x", { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(reason);

    const error = await result;
    expect(error).toMatchObject({
      status: 0,
      code: "ABORTED",
      message: "the request was cancelled",
    });
    // The caller's reason reaches fetch, so fetch rejects with it.
    expect(callOf(fetchMock).init.signal?.reason).toBe(reason);
    expect(error.cause).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails with NETWORK_ERROR when fetch rejects", async () => {
    const { api, fetchMock } = setup();
    const cause = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(cause);

    const error = await failure(api.request("/v1/x"));
    expect(error).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      message: "the API could not be reached",
    });
    expect(error.cause).toBe(cause);
  });
});

describe("request: retries", () => {
  it("retries a GET after a network error with a doubling delay", async () => {
    const { api, fetchMock } = setup({ retries: 2, retryDelayMs: 100 });
    fetchMock
      .mockRejectedValueOnce(new TypeError("down"))
      .mockRejectedValueOnce(new TypeError("down"))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const result = api.request("/v1/x");
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(result).resolves.toEqual({ ok: true });
  });

  it("waits 300 ms before the first retry by default", async () => {
    const { api, fetchMock } = setup({ retries: 1 });
    fetchMock
      .mockRejectedValueOnce(new TypeError("down"))
      .mockResolvedValueOnce(json(200, {}));

    const result = api.request("/v1/x");
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry unless retries is set", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockRejectedValue(new TypeError("down"));

    expect((await failure(api.request("/v1/x"))).code).toBe("NETWORK_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a GET whose attempt timed out", async () => {
    const { api, fetchMock } = setup({
      retries: 1,
      retryDelayMs: 10,
      timeoutMs: 1_000,
    });
    fetchMock
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValueOnce(json(200, { ok: 1 }));

    const result = api.request("/v1/x");
    await vi.advanceTimersByTimeAsync(1_010);

    await expect(result).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([502, 503, 504])("retries a GET answered with %i", async (status) => {
    const { api, fetchMock } = setup({ retries: 1, retryDelayMs: 10 });
    fetchMock
      .mockResolvedValueOnce(json(status, errorBody("INTERNAL_ERROR")))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const result = api.request("/v1/x");
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries an HTML 502 page from a proxy", async () => {
    const { api, fetchMock } = setup({ retries: 1, retryDelayMs: 10 });
    fetchMock
      .mockResolvedValueOnce(text(502, "<html>Bad Gateway</html>"))
      .mockResolvedValueOnce(json(200, {}));

    const result = api.request("/v1/x");
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toEqual({});
  });

  it("gives up with the last error when the retries run out", async () => {
    const { api, fetchMock } = setup({ retries: 2, retryDelayMs: 10 });
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        json(503, errorBody("UNAVAILABLE"), {
          "X-Request-ID": `req-${fetchMock.mock.calls.length}`,
        }),
      ),
    );

    const result = failure(api.request("/v1/x"));
    await vi.advanceTimersByTimeAsync(100);

    const error = await result;
    expect(error).toMatchObject({ status: 503, requestId: "req-3" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["500", () => json(500, errorBody("INTERNAL_ERROR"))],
    ["404", () => json(404, errorBody("NOT_FOUND"))],
    ["429", () => json(429, errorBody("RATE_LIMITED"))],
    ["a 200 that is not JSON", () => text(200, "<html>")],
  ])("does not retry %s", async (_, response) => {
    const { api, fetchMock } = setup({ retries: 3, retryDelayMs: 10 });
    fetchMock.mockImplementation(() => Promise.resolve(response()));

    const result = failure(api.request("/v1/x"));
    await vi.advanceTimersByTimeAsync(1_000);

    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "never retries a %s",
    async (method) => {
      const { api, fetchMock } = setup({ retries: 3, retryDelayMs: 10 });
      fetchMock.mockImplementation(() =>
        Promise.resolve(json(503, errorBody("UNAVAILABLE"))),
      );

      const result = failure(api.request("/v1/x", { method, retries: 3 }));
      await vi.advanceTimersByTimeAsync(1_000);

      expect((await result).status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("never retries a POST after a network error", async () => {
    const { api, fetchMock } = setup({ retries: 3, retryDelayMs: 10 });
    fetchMock.mockRejectedValue(new TypeError("down"));

    const result = failure(api.request("/v1/orders", { method: "POST" }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect((await result).code).toBe("NETWORK_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a HEAD", async () => {
    const { api, fetchMock } = setup({ retries: 1, retryDelayMs: 10 });
    fetchMock
      .mockRejectedValueOnce(new TypeError("down"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = api.request("/v1/x", { method: "HEAD" });
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rethrows a RangeError for retries that are not a whole number", async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValue(json(200, {}));

    await expect(api.request("/v1/x", { retries: 1.5 })).rejects.toThrow(
      RangeError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with ABORTED when the caller aborts during the wait between attempts", async () => {
    const { api, fetchMock } = setup({ retries: 3, retryDelayMs: 1_000 });
    fetchMock.mockRejectedValue(new TypeError("down"));
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    const result = failure(api.request("/v1/x", { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.abort();

    const error = await result;
    expect(error).toMatchObject({
      status: 0,
      code: "ABORTED",
      message: "the request was cancelled",
    });
    expect(error.cause).toMatchObject({ name: "AbortError" });
    // Nothing is left behind: no pending timer, and the attempt's listener
    // is removed (sleep's listener ran once and removed itself).
    expect(vi.getTimerCount()).toBe(0);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves no listener on the caller's signal after a retried success", async () => {
    const { api, fetchMock } = setup({ retries: 2, retryDelayMs: 10 });
    fetchMock
      .mockRejectedValueOnce(new TypeError("down"))
      .mockResolvedValueOnce(json(200, {}));
    const controller = new AbortController();
    const added: unknown[] = [];
    const removed: unknown[] = [];
    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      (_type, listener) => added.push(listener),
    );
    vi.spyOn(controller.signal, "removeEventListener").mockImplementation(
      (_type, listener) => removed.push(listener),
    );

    const result = api.request("/v1/x", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    await result;

    // Two attempts and one sleep each added a listener; every one is removed.
    expect(added).toHaveLength(3);
    expect(removed).toHaveLength(3);
    expect(new Set(removed)).toEqual(new Set(added));
    expect(vi.getTimerCount()).toBe(0);
  });
});
