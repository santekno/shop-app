import type { AdminProduct } from "@goshop/shared";
import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { PRODUCT_ID, adminImage, adminProduct } from "@/test/fixtures.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { deleteImageHandler } from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRouteHook } from "@/test/render.tsx";
import { productKeys } from "../api/queries.ts";
import { useDeleteProductImage } from "./useProductMutations.ts";

const first = adminImage(1);
const second = adminImage(2);

/** A client holding the product with two photos and a table page. */
const seeded = () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(
    productKeys.detail(PRODUCT_ID),
    adminProduct({ images: [first, second] }),
  );
  queryClient.setQueryData(productKeys.table({ page: 1 }), { data: [] });
  return queryClient;
};

const cachedImageIds = (queryClient: ReturnType<typeof createQueryClient>) =>
  queryClient
    .getQueryData<AdminProduct>(productKeys.detail(PRODUCT_ID))
    ?.images.map((i) => i.id);

describe("useDeleteProductImage", () => {
  it("DELETEs the photo, removes it from the cached product and marks the table stale", async () => {
    const sent = recordRequests();
    server.use(deleteImageHandler());
    const queryClient = seeded();
    const { result } = renderRouteHook(
      () => useDeleteProductImage(PRODUCT_ID),
      { queryClient },
    );

    await act(() => result.current.mutateAsync(first.id));

    expect(sent.map((r) => [r.method, r.url.pathname])).toEqual([
      ["DELETE", `/v1/admin/products/${PRODUCT_ID}/images/${first.id}`],
    ]);
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
    expect(cachedImageIds(queryClient)).toEqual([second.id]);
    expect(
      queryClient.getQueryState(productKeys.table({ page: 1 }))?.isInvalidated,
    ).toBe(true);
  });

  it("counts a photo already gone (404) as deleted", async () => {
    server.use(deleteImageHandler(() => errorResponse(404, "NOT_FOUND")));
    const queryClient = seeded();
    const { result } = renderRouteHook(
      () => useDeleteProductImage(PRODUCT_ID),
      { queryClient },
    );

    await act(() => result.current.mutateAsync(first.id));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedImageIds(queryClient)).toEqual([second.id]);
  });

  it("fails on any other error and keeps the photo", async () => {
    server.use(deleteImageHandler(() => errorResponse(500, "INTERNAL_ERROR")));
    const queryClient = seeded();
    const { result } = renderRouteHook(
      () => useDeleteProductImage(PRODUCT_ID),
      { queryClient },
    );

    act(() => {
      result.current.mutate(first.id);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(cachedImageIds(queryClient)).toEqual([first.id, second.id]);
    expect(
      queryClient.getQueryState(productKeys.table({ page: 1 }))?.isInvalidated,
    ).toBe(false);
  });
});
