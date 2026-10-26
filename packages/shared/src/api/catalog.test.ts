import { describe, expect, it, vi } from "vitest";
import { listCategories } from "./catalog.ts";
import { createApiClient } from "./client.ts";
import { ApiError } from "./errors.ts";
import type { Category } from "./types.ts";

const categories: Category[] = [
  { id: "1", slug: "pakaian", name: "Pakaian", parent_id: null },
  { id: "2", slug: "kaos", name: "Kaos", parent_id: "1" },
];

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
  return { api, fetchMock };
};

describe("listCategories", () => {
  it("GETs /v1/categories and returns the list inside the envelope", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: categories }));

    await expect(listCategories(api)).resolves.toEqual(categories);

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("http://api.test/v1/categories");
    expect(init?.method).toBe("GET");
  });

  it("returns an empty list as it is", async () => {
    const { api } = setup(() => Response.json({ data: [] }));

    await expect(listCategories(api)).resolves.toEqual([]);
  });

  it("passes the caller's signal on, so aborting it cancels the request", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: [] }));
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const controller = new AbortController();

    const pending = listCategories(api, { signal: controller.signal });
    const fetchSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("lets an API error through", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "INTERNAL_ERROR", message: "boom" } },
        { status: 500 },
      ),
    );

    const error: unknown = await listCategories(api).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});
