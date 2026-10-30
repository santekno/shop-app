import { describe, expect, it } from "vitest";
import { breadcrumbsFrom } from "./route-crumbs.ts";

const match = (handle: unknown, pathname: string) => ({ handle, pathname });

describe("breadcrumbsFrom", () => {
  it("gives one step per route with a crumb, outermost first", () => {
    expect(
      breadcrumbsFrom([
        match(undefined, "/"),
        match({ crumb: "Dasbor" }, "/"),
        match({ crumb: "Produk" }, "/produk"),
        match({ crumb: "Ubah produk" }, "/produk/p-1"),
      ]),
    ).toEqual([
      { label: "Dasbor", to: "/" },
      { label: "Produk", to: "/produk" },
      { label: "Ubah produk", to: "/produk/p-1" },
    ]);
  });

  it("keeps two steps that share a path", () => {
    expect(
      breadcrumbsFrom([
        match({ crumb: "Dasbor" }, "/"),
        match({ crumb: "Ringkasan" }, "/"),
      ]),
    ).toEqual([
      { label: "Dasbor", to: "/" },
      { label: "Ringkasan", to: "/" },
    ]);
  });

  it.each([
    ["no handle", undefined],
    ["a null handle", null],
    ["a string handle", "Produk"],
    ["a handle without crumb", { title: "Produk" }],
    ["a numeric crumb", { crumb: 3 }],
    ["an empty crumb", { crumb: "" }],
    ["a null crumb", { crumb: null }],
  ])("skips a route with %s", (_name, handle) => {
    expect(
      breadcrumbsFrom([
        match(handle, "/x"),
        match({ crumb: "Laporan" }, "/laporan"),
      ]),
    ).toEqual([{ label: "Laporan", to: "/laporan" }]);
  });

  it("is empty when no route names itself", () => {
    expect(breadcrumbsFrom([])).toEqual([]);
    expect(breadcrumbsFrom([match(undefined, "/masuk")])).toEqual([]);
  });
});
