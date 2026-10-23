// The ApiError mapping of @goshop/shared against real responses, from
// Node: the unit tests fake fetch, so only this proves that the client reads
// the error bodies and the X-Request-ID header the running API sends.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { createApiClient, isApiError, listCategories } from "@goshop/shared";
import { api, apiErrorOf, newRequestId } from "../support/api.ts";
import { API_URL, WEB_URL } from "../support/stack.ts";

test.describe("ApiError from real error responses", () => {
  test("404 on an unknown route, with the X-Request-ID the API echoed", async () => {
    const requestId = newRequestId();
    const error = await apiErrorOf(() =>
      api.request("/v1/no-such-route", {
        headers: { "X-Request-ID": requestId },
      }),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("route not found");
    expect(error.details).toEqual({});
    expect(error.requestId).toBe(requestId);
    expect(isApiError(error, "NOT_FOUND")).toBe(true);
    expect(isApiError(error, "VALIDATION_FAILED")).toBe(false);
  });

  test("404 from a handler (no such product), with a request ID the API generated", async () => {
    const slug = `tidak-ada-${Date.now()}`;
    const error = await apiErrorOf(() => api.request(`/v1/products/${slug}`));
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    // No X-Request-ID was sent, so the API made one: 16 random bytes in hex.
    expect(error.requestId).toMatch(/^[0-9a-f]{32}$/);

    // It is the one the response carried: ask again and compare with the
    // header of a plain fetch, sending the same ID both times.
    const requestId = newRequestId();
    const raw = await fetch(`${API_URL}/v1/products/${slug}`, {
      headers: { "X-Request-ID": requestId },
    });
    const viaClient = await apiErrorOf(() =>
      api.request(`/v1/products/${slug}`, {
        headers: { "X-Request-ID": requestId },
      }),
    );
    expect(raw.headers.get("X-Request-ID")).toBe(requestId);
    expect(viaClient.requestId).toBe(requestId);
    const body = (await raw.json()) as {
      error: { code: string; message: string };
    };
    expect(viaClient.code).toBe(body.error.code);
    expect(viaClient.message).toBe(body.error.message);
  });

  test("400 UNKNOWN_CATEGORY keeps the details of the error body", async () => {
    const error = await apiErrorOf(() =>
      api.request("/v1/products", {
        query: { category: "tidak-ada-kategori" },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("UNKNOWN_CATEGORY");
    expect(error.details).toEqual({ category: "tidak-ada-kategori" });
    expect(error.requestId).toMatch(/^[0-9a-f]{32}$/);
  });

  test("400 VALIDATION_FAILED for a query the contract forbids", async () => {
    const error = await apiErrorOf(() =>
      api.request("/v1/products", { query: { limit: 0 } }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(error.details).length).toBeGreaterThan(0);
  });

  test("405 METHOD_NOT_ALLOWED for a POST with a JSON body", async () => {
    const error = await apiErrorOf(() =>
      api.request("/v1/categories", { method: "POST", body: {} }),
    );
    expect(error.status).toBe(405);
    expect(error.code).toBe("METHOD_NOT_ALLOWED");
  });
});

test.describe("ApiError when there is no usable answer", () => {
  test("NETWORK_ERROR when nothing listens on the port", async () => {
    // Bind a free port, then close it: now nothing listens there.
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));

    const closed = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    const error = await apiErrorOf(() => listCategories(closed));
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.requestId).toBeUndefined();
  });

  test("CLIENT_TIMEOUT when the server never answers", async () => {
    // Accepts the connection and never writes a byte back.
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      const slow = createApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 300,
      });
      const error = await apiErrorOf(() => listCategories(slow));
      expect(error.status).toBe(0);
      expect(error.code).toBe("CLIENT_TIMEOUT");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("INVALID_RESPONSE when a 200 is not JSON (the storefront's HTML)", async () => {
    const notTheApi = createApiClient({ baseUrl: WEB_URL });
    const error = await apiErrorOf(() => notTheApi.request("/"));
    expect(error.status).toBe(200);
    expect(error.code).toBe("INVALID_RESPONSE");
  });
});
