import { describe, expect, it } from "@jest/globals";
import { waitFor } from "@testing-library/react-native";
import type { CategoryNode } from "@goshop/shared";

import { fakeApi, json } from "@/test/fake-api";
import { category } from "@/test/fixtures";
import { renderHookWithProviders } from "@/test/render";
import { flattenCategoryTree, useCategoryRows } from "./useCategoryRows";

const node = (slug: string, children: CategoryNode[] = []): CategoryNode => ({
  ...category(slug, slug.toUpperCase(), null, `id-${slug}`),
  children,
});

const shape = (rows: ReturnType<typeof flattenCategoryTree>) =>
  rows.map((row) => `${row.depth}:${row.node.slug}`);

describe("flattenCategoryTree", () => {
  it("is empty for no categories", () => {
    expect(flattenCategoryTree([])).toEqual([]);
  });

  it("walks depth first: a parent, its children, then the next parent", () => {
    const tree = [
      node("pakaian", [node("kaos", [node("kaos-polos")]), node("kemeja")]),
      node("aksesoris", [node("topi")]),
    ];

    expect(shape(flattenCategoryTree(tree))).toEqual([
      "0:pakaian",
      "1:kaos",
      "2:kaos-polos",
      "1:kemeja",
      "0:aksesoris",
      "1:topi",
    ]);
  });

  it("keeps the node itself in each row", () => {
    const kaos = node("kaos");
    const [row] = flattenCategoryTree([kaos]);
    expect(row?.node).toBe(kaos);
  });

  it("starts from the depth it is given", () => {
    expect(shape(flattenCategoryTree([node("a", [node("b")])], 3))).toEqual([
      "3:a",
      "4:b",
    ]);
  });
});

describe("useCategoryRows", () => {
  it("turns GET /v1/categories into rows, while the cache keeps the API's list", async () => {
    const list = [
      category("pakaian", "Pakaian", null, "p"),
      category("aksesoris", "Aksesoris", null, "a"),
      category("kaos", "Kaos", "p", "k"),
    ];
    fakeApi.on("GET", "/v1/categories", () => json({ data: list }));

    const { result, client } = await renderHookWithProviders(() =>
      useCategoryRows(),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(
      result.current.data?.map((row) => `${row.depth}:${row.node.slug}`),
    ).toEqual(["0:pakaian", "1:kaos", "0:aksesoris"]);
    // One cache entry, the web's key, the raw list: Beranda reads it too.
    expect(client.getQueryData(["categories"])).toEqual(list);
    expect(fakeApi.requests("GET", "/v1/categories")).toHaveLength(1);
  });
});
