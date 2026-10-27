import type { ProductList } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { product } from "@/test/fake-api.ts";
import { productListQuery } from "./queries.ts";

const page = (nextCursor: string | null): ProductList => ({
  data: [product("a")],
  page: { next_cursor: nextCursor },
});

const nextPageParam = (
  last: ProductList,
  lastPageParam: string | null,
): string | null | undefined =>
  productListQuery({ limit: 12 }).getNextPageParam(
    last,
    [last],
    lastPageParam,
    [lastPageParam],
  );

describe("productListQuery", () => {
  it("keys each combination of filters as its own list, starting without a cursor", () => {
    const filters = { category: "kaos", sort: "price_asc" as const, limit: 12 };
    const options = productListQuery(filters);

    expect(options.queryKey).toEqual(["products", "list", filters]);
    expect(options.initialPageParam).toBeNull();
  });

  it("asks for the next page with next_cursor", () => {
    expect(nextPageParam(page("c2"), null)).toBe("c2");
    expect(nextPageParam(page("c3"), "c2")).toBe("c3");
  });

  it("stops after the last page", () => {
    expect(nextPageParam(page(null), "c2")).toBeUndefined();
  });

  it("stops when next_cursor repeats the cursor just used", () => {
    expect(nextPageParam(page("c2"), "c2")).toBeUndefined();
  });

  it("keeps going after an empty page that still has a cursor", () => {
    expect(nextPageParam({ data: [], page: { next_cursor: "c3" } }, "c2")).toBe(
      "c3",
    );
  });
});
