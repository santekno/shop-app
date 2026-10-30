import type { ProductInput } from "@goshop/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CATEGORY_ID, adminVariant, category } from "@/test/fixtures.ts";
import { categoriesHandler } from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { ProductFormHarness } from "@/test/products-form-conflict.tsx";
import { formValues } from "@/test/products-stock.ts";
import { renderRoute } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { ProductReviewStep } from "./ProductReviewStep.tsx";

// The review step's artikel 05 parts: the stock badge of each variant,
// and the variants the save archives (loaded, no longer in the form).

const M = adminVariant(1, { name: "M", sku: "KAOS-M", stock: 12 });
const L = adminVariant(2, { name: "L", sku: "KAOS-L", stock: 3 });
const XL = adminVariant(3, { name: "XL", sku: "KAOS-XL", stock: 0 });

const renderReview = (
  values: ProductInput,
  loaded: ProductInput["variants"],
) => {
  server.use(categoriesHandler([category(CATEGORY_ID, "Kaos")]));
  renderRoute(
    <ProductFormHarness values={values}>
      <ProductReviewStep mode="edit" loaded={loaded} onEdit={vi.fn()} />
    </ProductFormHarness>,
  );
};

const archived = () =>
  screen.queryByRole("region", { name: /^Diarsipkan saat disimpan/ });

describe("ProductReviewStep with loaded variants", () => {
  it("lists the loaded variants the save archives, by name and SKU", () => {
    const loaded = formValues({ variants: [M, L, XL] });
    renderReview(
      { ...loaded, variants: loaded.variants.slice(1, 2) },
      loaded.variants,
    );

    const section = archived();
    if (section === null) throw new Error("no archived section");
    expect(section).toHaveAccessibleName("Diarsipkan saat disimpan (2)");
    expect(
      within(section)
        .getAllByRole("listitem")
        .map((item) => plain(item.textContent)),
    ).toEqual(["M (KAOS-M)", "XL (KAOS-XL)"]);
    expect(section).toHaveTextContent("tidak dapat dikembalikan");
  });

  it("lists nothing when every loaded variant is still there", () => {
    const loaded = formValues({ variants: [M, L] });
    renderReview(loaded, loaded.variants);

    expect(archived()).toBeNull();
  });

  it("badges each variant's stock in the table", () => {
    const loaded = formValues({ variants: [M, L, XL] });
    renderReview(loaded, loaded.variants);

    const table = screen.getByRole("table");
    const [, m, l, xl] = within(table).getAllByRole("row");
    expect(m).not.toHaveTextContent(/Stok (habis|menipis)/);
    expect(l).toHaveTextContent("Stok menipis3");
    expect(xl).toHaveTextContent("Stok habis0");
  });
});
