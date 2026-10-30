import { act, waitFor } from "@testing-library/react";
import { QueryClient, keepPreviousData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { AdminProduct, ProductWrite } from "@goshop/shared";
import { api } from "@/lib/api.ts";
import { createQueryClient } from "@/lib/query-client.ts";
import {
  PRODUCT_ID,
  adminImage,
  adminProduct,
  category,
  productTable,
} from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  archiveProductHandler,
  categoriesHandler,
  createProductHandler,
  deleteImageHandler,
  productDetailHandler,
  productResponse,
  productTableHandler,
  updateProductHandler,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRouteHook } from "@/test/render.tsx";
import {
  adminProductQuery,
  categoriesQuery,
  productKeys,
  productTableQuery,
} from "../api/queries.ts";
import { loadProductCreatePage, loadProductEditPage } from "../lazy.ts";
import { useAdminProduct } from "./useAdminProduct.ts";
import {
  useArchiveProduct,
  useCreateProduct,
  useDeleteProductImage,
  useUpdateProduct,
} from "./useProductMutations.ts";

const body: ProductWrite = {
  category_id: adminProduct().category_id,
  slug: "kaos-polos",
  name: "Kaos Polos",
  description: "",
  status: "draft",
  variants: [
    { sku: "KPH-M", name: "M", price: 89_000, stock: 12, weight_grams: 250 },
  ],
};

/** A cache holding a product table and this product, as after a visit. */
const seeded = (product: AdminProduct = adminProduct()) => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(productKeys.table({}), productTable([]));
  queryClient.setQueryData(productKeys.detail(product.id), product);
  return queryClient;
};
const invalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated;

describe("productKeys", () => {
  it("puts the products under one prefix, the categories apart", () => {
    expect(productKeys.all).toEqual(["admin", "products"]);
    expect(productKeys.tables).toEqual(["admin", "products", "table"]);
    expect(productKeys.table({ page: 2 })).toEqual([
      "admin",
      "products",
      "table",
      { page: 2 },
    ]);
    expect(productKeys.detail("p")).toEqual([
      "admin",
      "products",
      "detail",
      "p",
    ]);
    expect(productKeys.categories).toEqual(["categories"]);
  });
});

describe("the product queries", () => {
  it("categoriesQuery reads the public categories, fresh for five minutes", async () => {
    const sent = recordRequests();
    server.use(categoriesHandler([category("c-1", "Kaos")]));
    const options = categoriesQuery();

    await expect(new QueryClient().query(options)).resolves.toEqual([
      category("c-1", "Kaos"),
    ]);

    expect(options.staleTime).toBe(300_000);
    expect(sent[0]?.headers.has("Authorization")).toBe(false);
  });

  it("productTableQuery asks for exactly its query and keeps the last page meanwhile", async () => {
    const sent = recordRequests();
    server.use(productTableHandler(productTable([])));
    const options = productTableQuery(api, { status: "draft", page: 2 });

    await new QueryClient().query(options);

    expect(options.queryKey).toEqual(
      productKeys.table({ status: "draft", page: 2 }),
    );
    expect(options.placeholderData).toBe(keepPreviousData);
    expect(Object.fromEntries(sent[0]?.url.searchParams ?? [])).toEqual({
      status: "draft",
      page: "2",
    });
  });

  it("adminProductQuery is keyed by the product's ID", () => {
    expect(adminProductQuery(api, "p-1").queryKey).toEqual(
      productKeys.detail("p-1"),
    );
  });

  it("useAdminProduct loads the product as the logged-in user", async () => {
    const sent = recordRequests();
    server.use(productDetailHandler(adminProduct()));
    const { result } = renderRouteHook(() => useAdminProduct(PRODUCT_ID));

    await waitFor(() => {
      expect(result.current.data).toEqual(adminProduct());
    });
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
  });
});

describe("useCreateProduct", () => {
  it("POSTs the body, caches the new product and marks the tables stale", async () => {
    const sent = recordRequests();
    const created = adminProduct({ id: "new-id", status: "draft" });
    server.use(createProductHandler(() => productResponse(created, 201)));
    const queryClient = seeded();
    const { result } = renderRouteHook(() => useCreateProduct(), {
      queryClient,
    });

    await act(() => result.current.mutateAsync(body));

    expect(sent[0]?.method).toBe("POST");
    expect(await sent[0]?.json()).toEqual(body);
    expect(queryClient.getQueryData(productKeys.detail("new-id"))).toEqual(
      created,
    );
    expect(invalidated(queryClient, productKeys.table({}))).toBe(true);
  });

  it("changes nothing in the cache when the API refuses", async () => {
    server.use(createProductHandler(() => errorResponse(409, "SLUG_TAKEN")));
    const queryClient = seeded();
    const { result } = renderRouteHook(() => useCreateProduct(), {
      queryClient,
    });

    await act(() => result.current.mutateAsync(body).catch(() => undefined));

    await waitFor(() => {
      expect(result.current.error).toMatchObject({ code: "SLUG_TAKEN" });
    });
    expect(invalidated(queryClient, productKeys.table({}))).toBe(false);
  });
});

describe("useUpdateProduct", () => {
  it("PUTs the body to the product and puts the answer in its detail", async () => {
    const sent = recordRequests();
    const saved = adminProduct({ name: "Kaos Baru", version: 2 });
    server.use(updateProductHandler(() => productResponse(saved)));
    const queryClient = seeded();
    const { result } = renderRouteHook(() => useUpdateProduct(PRODUCT_ID), {
      queryClient,
    });

    await act(() => result.current.mutateAsync({ ...body, version: 1 }));

    expect(sent[0]?.method).toBe("PUT");
    expect(sent[0]?.url.pathname).toBe(`/v1/admin/products/${PRODUCT_ID}`);
    expect(await sent[0]?.json()).toMatchObject({ version: 1 });
    expect(queryClient.getQueryData(productKeys.detail(PRODUCT_ID))).toEqual(
      saved,
    );
    expect(invalidated(queryClient, productKeys.table({}))).toBe(true);
  });

  it("keeps the cached product after a 409", async () => {
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VERSION_CONFLICT", {
          details: { product_id: PRODUCT_ID },
        }),
      ),
    );
    const queryClient = seeded();
    const { result } = renderRouteHook(() => useUpdateProduct(PRODUCT_ID), {
      queryClient,
    });

    await act(() => result.current.mutateAsync(body).catch(() => undefined));

    expect(queryClient.getQueryData(productKeys.detail(PRODUCT_ID))).toEqual(
      adminProduct(),
    );
    expect(invalidated(queryClient, productKeys.table({}))).toBe(false);
  });
});

describe("useArchiveProduct", () => {
  it("DELETEs the product, marks the tables stale, and settles after the detail's refetch", async () => {
    const sent = recordRequests();
    const refetch = deferred<Response>();
    server.use(
      archiveProductHandler(),
      productDetailHandler(() => refetch.promise),
    );
    const queryClient = seeded();
    const { result } = renderRouteHook(
      () => ({
        archive: useArchiveProduct(PRODUCT_ID),
        detail: useAdminProduct(PRODUCT_ID),
      }),
      { queryClient },
    );
    let settled = false;

    act(() => {
      result.current.archive.mutate(undefined, {
        onSettled: () => {
          settled = true;
        },
      });
    });
    await waitFor(() => {
      expect(result.current.detail.isFetching).toBe(true);
    });
    expect(sent[0]?.method).toBe("DELETE");
    expect(invalidated(queryClient, productKeys.table({}))).toBe(true);
    expect(settled).toBe(false);

    refetch.resolve(productResponse(adminProduct({ status: "archived" })));
    await waitFor(() => {
      expect(settled).toBe(true);
    });
    expect(result.current.detail.data?.status).toBe("archived");
  });

  it("is in error when the archive fails, refetching nothing", async () => {
    server.use(
      archiveProductHandler(() => errorResponse(500, "INTERNAL_ERROR")),
    );
    const queryClient = seeded();
    const { result } = renderRouteHook(() => useArchiveProduct(PRODUCT_ID), {
      queryClient,
    });

    await act(() => result.current.mutateAsync().catch(() => undefined));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(invalidated(queryClient, productKeys.detail(PRODUCT_ID))).toBe(
      false,
    );
  });
});

describe("useDeleteProductImage", () => {
  const IMAGE_ID = "44444444-4444-4444-8444-000000000001";

  it("treats a photo already gone (404) as deleted", async () => {
    server.use(deleteImageHandler(() => errorResponse(404, "NOT_FOUND")));
    const queryClient = seeded(
      adminProduct({ images: [adminImage(1), adminImage(2)] }),
    );
    const { result } = renderRouteHook(
      () => useDeleteProductImage(PRODUCT_ID),
      { queryClient },
    );

    await act(() => result.current.mutateAsync(IMAGE_ID));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(
      queryClient
        .getQueryData<AdminProduct>(productKeys.detail(PRODUCT_ID))
        ?.images.map((image) => image.id),
    ).toEqual([adminImage(2).id]);
  });

  it("DELETEs the photo, and fails on any other error", async () => {
    const sent = recordRequests();
    server.use(deleteImageHandler(() => errorResponse(500, "INTERNAL_ERROR")));
    const { result } = renderRouteHook(() => useDeleteProductImage(PRODUCT_ID));

    await act(() =>
      result.current.mutateAsync(IMAGE_ID).catch(() => undefined),
    );

    await waitFor(() => {
      expect(result.current.error).toMatchObject({ code: "INTERNAL_ERROR" });
    });
    expect(sent[0]?.method).toBe("DELETE");
    expect(sent[0]?.url.pathname).toBe(
      `/v1/admin/products/${PRODUCT_ID}/images/${IMAGE_ID}`,
    );
  });
});

describe("lazy pages", () => {
  it("load the product form pages on demand", async () => {
    expect(typeof (await loadProductCreatePage()).ProductCreatePage).toBe(
      "function",
    );
    expect(typeof (await loadProductEditPage()).ProductEditPage).toBe(
      "function",
    );
  });
});
