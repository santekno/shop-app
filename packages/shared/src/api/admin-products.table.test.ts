import { describe, expect, it, vi } from "vitest";
import { listAdminProducts } from "./admin-products.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { AdminProductTable } from "./types.ts";

const table = {
  data: [],
  page: { page: 1, per_page: 20, total: 0, total_pages: 1 },
  low_stock_threshold: 5,
} as AdminProductTable;

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries: 0,
  });
  const url = () => {
    const [input] = fetchMock.mock.calls[0] ?? [];
    return new URL(typeof input === "string" ? input : "");
  };
  return { api, fetchMock, url };
};

describe("listAdminProducts", () => {
  it("GETs the product table with its query and returns the page as it is", async () => {
    const { api, url, fetchMock } = setup(() => Response.json(table));

    await expect(
      listAdminProducts(api, {
        q: "kaos polos",
        status: "draft",
        category_id: "c-1",
        low_stock: true,
        sort: "price_from",
        order: "asc",
        page: 2,
        per_page: 50,
      }),
    ).resolves.toEqual(table);

    expect(url().pathname).toBe("/v1/admin/products");
    expect(Object.fromEntries(url().searchParams)).toEqual({
      q: "kaos polos",
      status: "draft",
      category_id: "c-1",
      low_stock: "true",
      sort: "price_from",
      order: "asc",
      page: "2",
      per_page: "50",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });

  it("leaves out the parameters that are not set", async () => {
    const { api, url } = setup(() => Response.json(table));

    await listAdminProducts(api, { q: undefined, page: 1 });

    expect(url().search).toBe("?page=1");
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json(table));
    const controller = new AbortController();

    const pending = listAdminProducts(api, {}, { signal: controller.signal });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });

  it("throws the API's VALIDATION_FAILED", async () => {
    const { api } = setup(() =>
      Response.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "x",
            details: { page: "y" },
          },
        },
        { status: 400 },
      ),
    );

    const error: unknown = await listAdminProducts(api, { page: 0 }).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "VALIDATION_FAILED")).toBe(true);
  });
});
