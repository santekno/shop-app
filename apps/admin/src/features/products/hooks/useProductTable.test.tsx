import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { productRow, productTable } from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import { recordRequests } from "@/test/msw/http.ts";
import {
  productTableHandler,
  productTableResponse,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRouteHook } from "@/test/render.tsx";
import { productKeys } from "../api/queries.ts";
import {
  DEFAULT_PRODUCT_TABLE_PARAMS,
  toListAdminProductsQuery,
} from "../product-table-params.ts";
import type { ProductTableParams } from "../product-table-params.ts";
import { useProductTable } from "./useProductTable.ts";

describe("useProductTable", () => {
  it("asks the API for the page the params name, as the logged-in user", async () => {
    const sent = recordRequests();
    server.use(productTableHandler(productTable([productRow(1)])));
    const queryClient = createQueryClient();
    const params: ProductTableParams = {
      ...DEFAULT_PRODUCT_TABLE_PARAMS,
      q: "kaos",
      lowStock: true,
      page: 2,
    };

    const { result } = renderRouteHook(() => useProductTable(params), {
      queryClient,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.data[0]?.id).toBe(productRow(1).id);
    expect(Object.fromEntries(sent[0]?.url.searchParams ?? [])).toEqual({
      q: "kaos",
      low_stock: "true",
      sort: "updated_at",
      order: "desc",
      page: "2",
      per_page: "20",
    });
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
    expect(
      queryClient.getQueryData(
        productKeys.table(toListAdminProductsQuery(params)),
      ),
    ).toEqual(productTable([productRow(1)]));
  });

  it("keeps the last page on screen while the next one loads", async () => {
    const next = deferred<Response>();
    server.use(
      productTableHandler((request) =>
        new URL(request.url).searchParams.get("page") === "1"
          ? productTableResponse(productTable([productRow(1)], { total: 40 }))
          : next.promise,
      ),
    );
    const { result, rerender } = renderRouteHook(
      (params: ProductTableParams) => useProductTable(params),
      { initialProps: DEFAULT_PRODUCT_TABLE_PARAMS },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({ ...DEFAULT_PRODUCT_TABLE_PARAMS, page: 2 });

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.data[0]?.id).toBe(productRow(1).id);
    await act(async () => {
      next.resolve(
        productTableResponse(
          productTable([productRow(21)], { page: 2, total: 40 }),
        ),
      );
      await next.promise;
    });
    await waitFor(() => {
      expect(result.current.isPlaceholderData).toBe(false);
    });
    expect(result.current.data?.data[0]?.id).toBe(productRow(21).id);
  });
});
