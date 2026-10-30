import type { AdminProduct } from "@goshop/shared";
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { deferred } from "@/test/deferred.ts";
import { PRODUCT_ID, adminProduct, adminVariant } from "@/test/fixtures.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  stockAdjustmentHandler,
  variantResponse,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRouteHook } from "@/test/render.tsx";
import { productKeys } from "../api/queries.ts";
import { useQuickStockChange } from "./useQuickStockChange.ts";

const V1 = adminVariant(1).id;
const tableKey = productKeys.table({ page: 1 });

/** A cache holding the product (two variants) and a product table page. */
const seeded = () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(
    productKeys.detail(PRODUCT_ID),
    adminProduct({
      variants: [adminVariant(1, { stock: 12 }), adminVariant(2, { stock: 4 })],
    }),
  );
  queryClient.setQueryData(tableKey, { data: [] });
  return queryClient;
};

const invalidated = (
  queryClient: ReturnType<typeof createQueryClient>,
  key: readonly unknown[],
) => queryClient.getQueryState(key)?.isInvalidated;

const run = async (
  answer: Parameters<typeof stockAdjustmentHandler>[0],
  change: Parameters<ReturnType<typeof useQuickStockChange>["mutateAsync"]>[0],
) => {
  const sent = recordRequests();
  server.use(stockAdjustmentHandler(answer));
  const queryClient = seeded();
  const { result } = renderRouteHook(() => useQuickStockChange(PRODUCT_ID), {
    queryClient,
  });
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.mutateAsync(change).catch((e: unknown) => e);
  });
  return { sent, queryClient, outcome };
};

describe("useQuickStockChange", () => {
  it("POSTs a delta, patches the variant in the product, and refreshes the tables", async () => {
    const after = adminVariant(1, { stock: 17, version: 2 });
    const { sent, queryClient, outcome } = await run(
      () => variantResponse(after),
      {
        mode: "add",
        variantId: V1,
        amount: 5,
      },
    );

    expect(outcome).toEqual({
      kind: "saved",
      variant: after,
      from: 12,
      to: 17,
    });
    expect(sent[0]?.url.pathname).toBe(
      `/v1/admin/products/${PRODUCT_ID}/variants/${V1}/stock-adjustments`,
    );
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
    expect(await sent[0]?.json()).toEqual({ delta: 5 });
    const product = queryClient.getQueryData<AdminProduct>(
      productKeys.detail(PRODUCT_ID),
    );
    expect(product?.variants.map((v) => v.stock)).toEqual([17, 4]);
    expect(invalidated(queryClient, productKeys.detail(PRODUCT_ID))).toBe(
      false,
    );
    expect(invalidated(queryClient, tableKey)).toBe(true);
  });

  it("sends a count with the stock it expects", async () => {
    const { sent } = await run(
      () => variantResponse(adminVariant(1, { stock: 20 })),
      {
        mode: "set",
        variantId: V1,
        value: 20,
        expected: 12,
      },
    );

    expect(await sent[0]?.json()).toEqual({ set: 20, expected: 12 });
  });

  it("refetches the product, not the tables, when a count moved under the seller", async () => {
    const { queryClient, outcome } = await run(
      () => errorResponse(409, "STOCK_CHANGED", { details: { stock: 9 } }),
      { mode: "set", variantId: V1, value: 20, expected: 12 },
    );

    expect(outcome).toEqual({
      kind: "moved",
      expected: 12,
      current: 9,
      wanted: 20,
    });
    expect(invalidated(queryClient, productKeys.detail(PRODUCT_ID))).toBe(true);
    expect(invalidated(queryClient, tableKey)).toBe(false);
  });

  it("refetches the product when a difference would leave the range", async () => {
    const { queryClient, outcome } = await run(
      () => errorResponse(409, "STOCK_OUT_OF_RANGE", { details: { stock: 3 } }),
      { mode: "add", variantId: V1, amount: -5 },
    );

    expect(outcome).toEqual({ kind: "out-of-range", current: 3, to: -2 });
    expect(invalidated(queryClient, productKeys.detail(PRODUCT_ID))).toBe(true);
    expect(invalidated(queryClient, tableKey)).toBe(false);
  });

  it("refetches the product and the tables when the variant is gone", async () => {
    const { queryClient, outcome } = await run(
      () => errorResponse(409, "VARIANT_ARCHIVED"),
      {
        mode: "add",
        variantId: V1,
        amount: 1,
      },
    );

    expect(outcome).toEqual({ kind: "gone" });
    expect(invalidated(queryClient, productKeys.detail(PRODUCT_ID))).toBe(true);
    expect(invalidated(queryClient, tableKey)).toBe(true);
  });

  it("rejects with any other error, changing nothing in the cache", async () => {
    const { queryClient, outcome } = await run(
      () => errorResponse(500, "INTERNAL_ERROR"),
      {
        mode: "add",
        variantId: V1,
        amount: 1,
      },
    );

    expect(outcome).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(invalidated(queryClient, productKeys.detail(PRODUCT_ID))).toBe(
      false,
    );
    expect(invalidated(queryClient, tableKey)).toBe(false);
    expect(
      queryClient.getQueryData<AdminProduct>(productKeys.detail(PRODUCT_ID))
        ?.variants[0]?.stock,
    ).toBe(12);
  });

  it("leaves an empty cache empty after a save", async () => {
    server.use(
      stockAdjustmentHandler(() =>
        variantResponse(adminVariant(1, { stock: 13 })),
      ),
    );
    const queryClient = createQueryClient();
    const { result } = renderRouteHook(() => useQuickStockChange(PRODUCT_ID), {
      queryClient,
    });

    await act(() =>
      result.current.mutateAsync({ mode: "add", variantId: V1, amount: 1 }),
    );

    expect(
      queryClient.getQueryData(productKeys.detail(PRODUCT_ID)),
    ).toBeUndefined();
  });

  describe("with a detail refetch on its way", () => {
    /**
     * The cache as seeded, a detail fetch that read the product before
     * the change (the photo poll, the window regaining the focus), and
     * the hook.
     */
    const inFlight = (answer: Parameters<typeof stockAdjustmentHandler>[0]) => {
      server.use(stockAdjustmentHandler(answer));
      const queryClient = seeded();
      const older = deferred<AdminProduct>();
      const refetch = queryClient
        .query({
          queryKey: productKeys.detail(PRODUCT_ID),
          queryFn: () => older.promise,
          // The cache's copy is fresh; a poll or a focus refetch fetches
          // anyway.
          staleTime: 0,
        })
        .catch(() => undefined);
      expect(
        queryClient.isFetching({ queryKey: productKeys.detail(PRODUCT_ID) }),
      ).toBe(1);
      const { result } = renderRouteHook(
        () => useQuickStockChange(PRODUCT_ID),
        { queryClient },
      );
      const variants = () =>
        queryClient
          .getQueryData<AdminProduct>(productKeys.detail(PRODUCT_ID))
          ?.variants.map((v) => [v.stock, v.version]);
      return { queryClient, older, refetch, result, variants };
    };

    it("keeps the saved stock and version when the older copy arrives", async () => {
      const { older, refetch, result, variants } = inFlight(() =>
        variantResponse(adminVariant(1, { stock: 17, version: 2 })),
      );

      await act(() =>
        result.current.mutateAsync({ mode: "add", variantId: V1, amount: 5 }),
      );
      expect(variants()?.[0]).toEqual([17, 2]);

      older.resolve(
        adminProduct({
          variants: [
            adminVariant(1, { stock: 12, version: 1 }),
            adminVariant(2, { stock: 4 }),
          ],
        }),
      );
      await act(() => refetch);

      expect(variants()?.[0]).toEqual([17, 2]);
    });

    it("lets the refetch land after a result that is not a save, and marks the product stale", async () => {
      const { queryClient, older, refetch, result, variants } = inFlight(() =>
        errorResponse(409, "STOCK_CHANGED", { details: { stock: 9 } }),
      );

      await act(() =>
        result.current.mutateAsync({
          mode: "set",
          variantId: V1,
          value: 20,
          expected: 12,
        }),
      );
      expect(
        queryClient.getQueryState(productKeys.detail(PRODUCT_ID))
          ?.isInvalidated,
      ).toBe(true);

      older.resolve(
        adminProduct({
          variants: [
            adminVariant(1, { stock: 9, version: 3 }),
            adminVariant(2, { stock: 4 }),
          ],
        }),
      );
      await act(() => refetch);

      expect(variants()?.[0]).toEqual([9, 3]);
    });
  });
});
