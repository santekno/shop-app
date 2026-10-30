import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { category } from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import { errorResponse } from "@/test/msw/http.ts";
import { categoriesHandler, categoriesResponse } from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { DEFAULT_PRODUCT_TABLE_PARAMS } from "../product-table-params.ts";
import type { ProductTableParams } from "../product-table-params.ts";
import { ProductFilters } from "./ProductFilters.tsx";

const KAOS = "0b6d2a4e-0000-4000-8000-00000000000a";
const POLOS = "0b6d2a4e-0000-4000-8000-00000000000b";
const UNKNOWN = "0b6d2a4e-0000-4000-8000-00000000000f";

const categories = [category(KAOS, "Kaos"), category(POLOS, "Polos", KAOS)];

const renderFilters = (
  change: Partial<ProductTableParams> = {},
  { lowStockThreshold }: { lowStockThreshold?: number } = {},
) => {
  const onChange = vi.fn();
  renderRoute(
    <ProductFilters
      params={{ ...DEFAULT_PRODUCT_TABLE_PARAMS, ...change }}
      onChange={onChange}
      lowStockThreshold={lowStockThreshold}
    />,
  );
  return onChange;
};

const categorySelect = () => screen.getByLabelText("Kategori");
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("ProductFilters", () => {
  it("lists every status, 'Semua status' first", () => {
    server.use(categoriesHandler(categories));
    renderFilters();

    expect(optionTexts(screen.getByLabelText("Status"))).toEqual([
      "Semua status",
      "Aktif",
      "Draf",
      "Diarsipkan",
    ]);
    expect(screen.getByLabelText("Status")).toHaveValue("");
  });

  it("filters by a status, and back to all", async () => {
    server.use(categoriesHandler(categories));
    const user = userEvent.setup();
    const onChange = renderFilters({ status: "draft" });

    expect(screen.getByLabelText("Status")).toHaveValue("draft");
    await user.selectOptions(screen.getByLabelText("Status"), "Aktif");
    await user.selectOptions(screen.getByLabelText("Status"), "Semua status");

    expect(onChange.mock.calls).toEqual([
      [{ status: "active" }],
      [{ status: undefined }],
    ]);
  });

  it("says the categories are loading, then lists them indented under their parent", async () => {
    const answer = deferred<Response>();
    server.use(categoriesHandler(() => answer.promise));
    renderFilters();

    const loading = within(categorySelect()).getByRole("option", {
      name: "Memuat kategori…",
    });
    expect(loading).toBeDisabled();
    answer.resolve(categoriesResponse(categories));

    // The indent is made of wide Unicode spaces (a <select> shows no
    // padding), so the child's text starts with whitespace, the parent's not.
    await waitFor(() => {
      expect(optionTexts(categorySelect())).toHaveLength(3);
    });
    const [all, parent, child] = optionTexts(categorySelect());
    expect(all).toBe("Semua kategori");
    expect(parent).toBe("Kaos");
    expect(child).toMatch(/^\s+Polos$/u);
  });

  it("filters by a category, and back to all", async () => {
    server.use(categoriesHandler(categories));
    const user = userEvent.setup();
    const onChange = renderFilters();
    await within(categorySelect()).findByRole("option", { name: "Kaos" });

    await user.selectOptions(categorySelect(), KAOS);
    await user.selectOptions(categorySelect(), "");

    expect(onChange.mock.calls).toEqual([
      [{ categoryId: KAOS }],
      [{ categoryId: undefined }],
    ]);
  });

  it("names a category from the URL that the list does not have", async () => {
    server.use(categoriesHandler(categories));
    renderFilters({ categoryId: UNKNOWN });

    await within(categorySelect()).findByRole("option", {
      name: "Kategori tidak dikenal",
    });
    expect(categorySelect()).toHaveValue(UNKNOWN);
  });

  it("says nothing unknown about a category the list has", async () => {
    server.use(categoriesHandler(categories));
    renderFilters({ categoryId: POLOS });

    await within(categorySelect()).findByRole("option", { name: /Polos/ });
    expect(
      within(categorySelect()).queryByRole("option", {
        name: "Kategori tidak dikenal",
      }),
    ).toBeNull();
    expect(categorySelect()).toHaveValue(POLOS);
  });

  it("says the categories failed, and loads them again from Coba lagi", async () => {
    let calls = 0;
    server.use(
      categoriesHandler(() => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, "INTERNAL_ERROR")
          : categoriesResponse(categories);
      }),
    );
    const user = userEvent.setup();
    renderFilters({ categoryId: UNKNOWN });

    const error = await screen.findByText(/Kategori tidak dapat dimuat\./);
    expect(categorySelect()).toHaveAccessibleDescription(
      /Kategori tidak dapat dimuat\./,
    );
    // Not known as unknown while the list could not be loaded.
    expect(
      within(categorySelect()).queryByRole("option", {
        name: "Kategori tidak dikenal",
      }),
    ).toBeNull();
    await user.click(within(error).getByRole("button", { name: "Coba lagi" }));

    await within(categorySelect()).findByRole("option", { name: "Kaos" });
    expect(screen.queryByText(/Kategori tidak dapat dimuat/)).toBeNull();
  });

  it("turns the low-stock filter on and off", async () => {
    server.use(categoriesHandler(categories));
    const user = userEvent.setup();
    const onChange = renderFilters();

    await user.click(screen.getByRole("checkbox", { name: /^Stok menipis/ }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ lowStock: true });
  });

  it("shows the API's low-stock threshold in the label once it is known", () => {
    server.use(categoriesHandler(categories));
    renderFilters({ lowStock: true }, { lowStockThreshold: 8 });

    const box = screen.getByRole("checkbox", { name: "Stok menipis (≤ 8)" });
    expect(box).toBeChecked();
  });

  it("has no number in the label before the first answer", () => {
    server.use(categoriesHandler(categories));
    renderFilters();

    expect(
      screen.getByRole("checkbox", { name: "Stok menipis" }),
    ).not.toBeChecked();
  });

  it("offers Hapus filter only while a filter is on, and clears them all", async () => {
    server.use(categoriesHandler(categories));
    const user = userEvent.setup();
    const onChange = renderFilters({ status: "draft", lowStock: true });

    await user.click(screen.getByRole("button", { name: "Hapus filter" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      q: undefined,
      status: undefined,
      categoryId: undefined,
      lowStock: false,
    });
  });

  it("offers no Hapus filter for sorting and paging alone", () => {
    server.use(categoriesHandler(categories));
    renderFilters({ sort: "name", page: 3 });

    expect(screen.queryByRole("button", { name: "Hapus filter" })).toBeNull();
  });

  it("pushes a first search and replaces the URL while one is refined", async () => {
    server.use(categoriesHandler(categories));
    const user = userEvent.setup();
    const onChange = renderFilters();

    await user.type(screen.getByRole("searchbox"), "kaos{Enter}");

    expect(onChange).toHaveBeenLastCalledWith(
      { q: "kaos" },
      { replace: false },
    );
  });

  it("replaces the URL when an existing search is changed, not when it is cleared", async () => {
    server.use(categoriesHandler(categories));
    const user = userEvent.setup();
    const onChange = renderFilters({ q: "kaos" });
    const box = screen.getByRole("searchbox");

    await user.type(box, " polos{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(
      { q: "kaos polos" },
      { replace: true },
    );
    await user.clear(box);
    await user.type(box, "{Enter}");

    expect(onChange).toHaveBeenLastCalledWith(
      { q: undefined },
      { replace: false },
    );
  });
});
