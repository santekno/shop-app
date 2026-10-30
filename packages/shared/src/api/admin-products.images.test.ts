import { describe, expect, it, vi } from "vitest";
import {
  confirmProductImage,
  deleteProductImage,
  startProductImageUpload,
} from "./admin-products.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { AdminProductImage, ImageUpload } from "./types.ts";

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries: 3,
    retryDelayMs: 0,
  });
  const call = (index = 0) => {
    const [input, init] = fetchMock.mock.calls[index] ?? [];
    return { url: new URL(typeof input === "string" ? input : ""), init };
  };
  return { api, fetchMock, call };
};

const image = { id: "img-1", status: "pending_upload" } as AdminProductImage;
const upload = {
  image,
  upload: {
    method: "PUT",
    url: "http://storage.test/x",
    headers: { "Content-Type": "image/jpeg" },
    expires_at: "2026-10-30T03:15:00Z",
  },
} as ImageUpload;

const apiError = (status: number, code: string, details?: object) =>
  Response.json({ error: { code, message: "x", details } }, { status });

describe("startProductImageUpload", () => {
  it("POSTs the type and size and returns the image with its ticket", async () => {
    const { api, call } = setup(() =>
      Response.json({ data: upload }, { status: 201 }),
    );

    await expect(
      startProductImageUpload(api, "p/1", {
        content_type: "image/jpeg",
        size_bytes: 1234,
      }),
    ).resolves.toEqual(upload);

    expect(call().url.pathname).toBe("/v1/admin/products/p%2F1/images/uploads");
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual({
      content_type: "image/jpeg",
      size_bytes: 1234,
    });
  });

  it("is never retried, even on 503, and throws the API's code", async () => {
    const { api, fetchMock } = setup(() => apiError(503, "STORAGE_DISABLED"));

    const error: unknown = await startProductImageUpload(api, "p1", {
      content_type: "image/png",
      size_bytes: 1,
    }).catch((e: unknown) => e);

    expect(isApiError(error, "STORAGE_DISABLED")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: upload }));
    const controller = new AbortController();

    const pending = startProductImageUpload(
      api,
      "p1",
      { content_type: "image/png", size_bytes: 1 },
      { signal: controller.signal },
    );
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("confirmProductImage", () => {
  it("POSTs an empty alt by default, both IDs escaped", async () => {
    const { api, call } = setup(() => Response.json({ data: image }));

    await expect(confirmProductImage(api, "p 1", "i/1")).resolves.toEqual(
      image,
    );

    expect(call().url.pathname).toBe(
      "/v1/admin/products/p%201/images/i%2F1/confirm",
    );
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual({ alt: "" });
  });

  it("sends the alt text it is given", async () => {
    const { api, call } = setup(() => Response.json({ data: image }));

    await confirmProductImage(api, "p1", "i1", { alt: "Kaos hitam" });

    expect(JSON.parse(call().init?.body as string)).toEqual({
      alt: "Kaos hitam",
    });
  });

  it("throws UPLOAD_INVALID with its reason, never retried", async () => {
    const { api, fetchMock } = setup(() =>
      apiError(422, "UPLOAD_INVALID", { reason: "too_many_pixels" }),
    );

    const error: unknown = await confirmProductImage(api, "p1", "i1").catch(
      (e: unknown) => e,
    );

    expect(isApiError(error, "UPLOAD_INVALID")).toBe(true);
    expect(error).toMatchObject({ details: { reason: "too_many_pixels" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: image }));
    const controller = new AbortController();

    const pending = confirmProductImage(api, "p1", "i1", undefined, {
      signal: controller.signal,
    });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("deleteProductImage", () => {
  it("DELETEs the photo and resolves on 204", async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));

    await expect(deleteProductImage(api, "p1", "i/1")).resolves.toBeUndefined();

    expect(call().url.pathname).toBe("/v1/admin/products/p1/images/i%2F1");
    expect(call().init?.method).toBe("DELETE");
  });

  it("throws NOT_FOUND for a photo that is gone", async () => {
    const { api } = setup(() => apiError(404, "NOT_FOUND"));

    const error: unknown = await deleteProductImage(api, "p1", "i1").catch(
      (e: unknown) => e,
    );

    expect(isApiError(error, "NOT_FOUND")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => new Response(null, { status: 204 }));
    const controller = new AbortController();

    const pending = deleteProductImage(api, "p1", "i1", {
      signal: controller.signal,
    });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
