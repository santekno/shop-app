import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { category } from "@/test/fixtures.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { categoriesHandler } from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRouteHook } from "@/test/render.tsx";
import { toCategoryOptions, useCategoryOptions } from "./useCategoryOptions.ts";

// Children before their parents, as an API might list them: the options
// must still come out parent first.
const tree = [
  category("c-polos", "Kaos polos", "c-kaos"),
  category("c-aksesori", "Aksesori"),
  category("c-kaos", "Kaos", "c-pakaian"),
  category("c-pakaian", "Pakaian"),
  category("c-topi", "Topi", "c-pakaian"),
];

describe("toCategoryOptions", () => {
  it("lists parents before their children, depth first, with each depth", () => {
    expect(toCategoryOptions(tree)).toEqual([
      { id: "c-aksesori", name: "Aksesori", depth: 0 },
      { id: "c-pakaian", name: "Pakaian", depth: 0 },
      { id: "c-kaos", name: "Kaos", depth: 1 },
      { id: "c-polos", name: "Kaos polos", depth: 2 },
      { id: "c-topi", name: "Topi", depth: 1 },
    ]);
  });

  it("puts a category whose parent is missing at the top level", () => {
    expect(toCategoryOptions([category("c-anak", "Anak", "c-hilang")])).toEqual(
      [{ id: "c-anak", name: "Anak", depth: 0 }],
    );
  });

  it("is empty without categories", () => {
    expect(toCategoryOptions([])).toEqual([]);
  });
});

describe("useCategoryOptions", () => {
  it("loads GET /v1/categories without a token and flattens it", async () => {
    const sent = recordRequests();
    server.use(categoriesHandler(tree));

    const { result } = renderRouteHook(() => useCategoryOptions());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((option) => option.id)).toEqual([
      "c-aksesori",
      "c-pakaian",
      "c-kaos",
      "c-polos",
      "c-topi",
    ]);
    expect(sent[0]?.url.pathname).toBe("/v1/categories");
    expect(sent[0]?.headers.get("Authorization")).toBeNull();
  });

  it("is in error when the categories cannot be loaded", async () => {
    server.use(categoriesHandler(() => errorResponse(500, "INTERNAL_ERROR")));

    const { result } = renderRouteHook(() => useCategoryOptions());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});
