import { describe, expect, it } from "vitest";
import {
  CLEAR_FILTERS,
  DEFAULT_PRODUCT_TABLE_PARAMS,
  MAX_PAGE,
  MAX_QUERY_LENGTH,
  hasActiveFilters,
  isSortableColumn,
  nextProductTableParams,
  normaliseQuery,
  productTableSearchParams,
  readProductTableParams,
  toListAdminProductsQuery,
} from "./product-table-params.ts";
import type { ProductTableParams } from "./product-table-params.ts";

const read = (query: string) =>
  readProductTableParams(new URLSearchParams(query));
const UUID = "0b6d2a4e-0000-4000-8000-00000000000a";

describe("readProductTableParams", () => {
  it("is the API's defaults with nothing in the URL", () => {
    expect(read("")).toEqual(DEFAULT_PRODUCT_TABLE_PARAMS);
    expect(DEFAULT_PRODUCT_TABLE_PARAMS).toEqual({
      q: undefined,
      status: undefined,
      categoryId: undefined,
      lowStock: false,
      sort: "updated_at",
      order: "desc",
      page: 1,
      perPage: 20,
    });
  });

  it("reads every parameter in its URL word", () => {
    expect(
      read(
        `q=kaos&status=arsip&kategori=${UUID}&stok=menipis&urut=harga&arah=naik&halaman=3&per_halaman=50`,
      ),
    ).toEqual({
      q: "kaos",
      status: "archived",
      categoryId: UUID,
      lowStock: true,
      sort: "price_from",
      order: "asc",
      page: 3,
      perPage: 50,
    });
  });

  it.each([
    ["aktif", "active"],
    ["draf", "draft"],
    ["arsip", "archived"],
  ])("reads status=%s as %s", (param, status) => {
    expect(read(`status=${param}`).status).toBe(status);
  });

  it.each([
    ["nama", "name"],
    ["harga", "price_from"],
    ["stok", "stock"],
    ["diubah", "updated_at"],
    ["dibuat", "created_at"],
  ])("reads urut=%s as %s", (param, sort) => {
    expect(read(`urut=${param}&arah=turun`).sort).toBe(sort);
  });

  it.each([
    ["0", 1],
    ["-3", 1],
    ["10001", 1],
    ["1e3", 1],
    ["02", 1],
    ["1.5", 1],
    ["abc", 1],
    ["10000", 10_000],
    ["7", 7],
  ])("reads halaman=%s as page %d", (param, page) => {
    expect(read(`halaman=${param}`).page).toBe(page);
    expect(MAX_PAGE).toBe(10_000);
  });

  it.each([
    ["10", 10],
    ["100", 100],
    ["7", 20],
    ["25", 20],
    ["", 20],
  ])("reads per_halaman=%s as %d rows", (param, perPage) => {
    expect(read(`per_halaman=${param}`).perPage).toBe(perPage);
  });

  it.each([
    ["an unknown status", "status=semua", "status"],
    ["an unknown sort", "urut=warna", "sort"],
    ["an unknown order", "arah=atas", "order"],
  ] as const)("falls back to the default for %s", (_name, query, field) => {
    expect(read(query)[field]).toBe(DEFAULT_PRODUCT_TABLE_PARAMS[field]);
  });

  it("reads arah=naik as ascending", () => {
    expect(read("arah=naik").order).toBe("asc");
  });

  it("ignores a category that is not a UUID and lower-cases one that is", () => {
    expect(read("kategori=kaos").categoryId).toBeUndefined();
    expect(read(`kategori=${UUID}x`).categoryId).toBeUndefined();
    expect(read(`kategori=x${UUID}`).categoryId).toBeUndefined();
    expect(read(`kategori=${UUID.toUpperCase()}`).categoryId).toBe(UUID);
  });

  it("turns the low-stock filter on only for stok=menipis", () => {
    expect(read("stok=menipis").lowStock).toBe(true);
    expect(read("stok=habis").lowStock).toBe(false);
    expect(read("stok=").lowStock).toBe(false);
  });

  it("trims the search, and spaces alone are no search", () => {
    expect(read("q=%20%20kaos%20").q).toBe("kaos");
    expect(read("q=%20%20").q).toBeUndefined();
  });
});

describe("normaliseQuery", () => {
  it("cuts a long search at 100 code points, an emoji counting once", () => {
    const emoji = "😀".repeat(101);

    expect(MAX_QUERY_LENGTH).toBe(100);
    expect(Array.from(normaliseQuery(emoji) ?? "")).toHaveLength(100);
    expect(normaliseQuery("a".repeat(150))).toBe("a".repeat(100));
  });

  it("trims what is left after the cut", () => {
    expect(normaliseQuery(`${"a".repeat(99)} b`)).toBe("a".repeat(99));
  });

  it("is undefined for an empty or blank search", () => {
    expect(normaliseQuery("")).toBeUndefined();
    expect(normaliseQuery(" \t ")).toBeUndefined();
  });
});

describe("productTableSearchParams", () => {
  it("leaves out every default", () => {
    expect(
      productTableSearchParams(DEFAULT_PRODUCT_TABLE_PARAMS).toString(),
    ).toBe("");
  });

  it("writes the parameters in a fixed order", () => {
    const state: ProductTableParams = {
      perPage: 50,
      page: 2,
      order: "asc",
      sort: "stock",
      lowStock: true,
      categoryId: UUID,
      status: "draft",
      q: "kaos polos",
    };

    expect(productTableSearchParams(state).toString()).toBe(
      `q=kaos+polos&status=draf&kategori=${UUID}&stok=menipis&urut=stok&arah=naik&halaman=2&per_halaman=50`,
    );
  });

  it.each<Partial<ProductTableParams>>([
    { q: "kaos" },
    { status: "archived", sort: "name", order: "asc" },
    { categoryId: UUID, lowStock: true, page: 4, perPage: 100 },
    { sort: "created_at", order: "desc", page: 10_000 },
  ])("round-trips %j", (change) => {
    const state = { ...DEFAULT_PRODUCT_TABLE_PARAMS, ...change };

    expect(readProductTableParams(productTableSearchParams(state))).toEqual(
      state,
    );
  });
});

describe("nextProductTableParams", () => {
  const onPage4 = { ...DEFAULT_PRODUCT_TABLE_PARAMS, page: 4 };

  it("goes back to page 1 for any change but the page", () => {
    expect(nextProductTableParams(onPage4, { status: "active" })).toEqual({
      ...onPage4,
      status: "active",
      page: 1,
    });
  });

  it("keeps the page a change names", () => {
    expect(nextProductTableParams(onPage4, { page: 5 }).page).toBe(5);
    expect(nextProductTableParams(onPage4, { page: 5, perPage: 50 })).toEqual({
      ...onPage4,
      page: 5,
      perPage: 50,
    });
  });
});

describe("hasActiveFilters and CLEAR_FILTERS", () => {
  it.each<Partial<ProductTableParams>>([
    { q: "kaos" },
    { status: "draft" },
    { categoryId: UUID },
    { lowStock: true },
  ])("is true for %j", (change) => {
    expect(
      hasActiveFilters({ ...DEFAULT_PRODUCT_TABLE_PARAMS, ...change }),
    ).toBe(true);
  });

  it("is false for sorting and paging alone", () => {
    expect(
      hasActiveFilters({
        ...DEFAULT_PRODUCT_TABLE_PARAMS,
        sort: "name",
        page: 3,
        perPage: 50,
      }),
    ).toBe(false);
  });

  it("clears every filter, keeping sort and page size", () => {
    const filtered: ProductTableParams = {
      ...DEFAULT_PRODUCT_TABLE_PARAMS,
      q: "kaos",
      status: "draft",
      categoryId: UUID,
      lowStock: true,
      sort: "name",
      perPage: 50,
    };

    const cleared = nextProductTableParams(filtered, CLEAR_FILTERS);

    expect(hasActiveFilters(cleared)).toBe(false);
    expect(cleared.sort).toBe("name");
    expect(cleared.perPage).toBe(50);
  });
});

describe("toListAdminProductsQuery", () => {
  it("names every parameter as the API does, defaults included", () => {
    expect(toListAdminProductsQuery(DEFAULT_PRODUCT_TABLE_PARAMS)).toEqual({
      q: undefined,
      status: undefined,
      category_id: undefined,
      low_stock: undefined,
      sort: "updated_at",
      order: "desc",
      page: 1,
      per_page: 20,
    });
  });

  it("sends low_stock only when it is on", () => {
    expect(
      toListAdminProductsQuery({
        ...DEFAULT_PRODUCT_TABLE_PARAMS,
        q: "kaos",
        status: "active",
        categoryId: UUID,
        lowStock: true,
        page: 2,
        perPage: 50,
      }),
    ).toEqual({
      q: "kaos",
      status: "active",
      category_id: UUID,
      low_stock: true,
      sort: "updated_at",
      order: "desc",
      page: 2,
      per_page: 50,
    });
  });
});

describe("isSortableColumn", () => {
  it.each(["name", "price_from", "stock", "updated_at", "created_at"])(
    "sorts by %s",
    (id) => {
      expect(isSortableColumn(id)).toBe(true);
    },
  );

  it.each(["status", "variant_count", "thumbnail", ""])(
    "does not sort by %j",
    (id) => {
      expect(isSortableColumn(id)).toBe(false);
    },
  );
});
