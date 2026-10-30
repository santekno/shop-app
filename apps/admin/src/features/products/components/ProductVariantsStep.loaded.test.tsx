import type { ProductInput } from "@goshop/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { adminVariant } from "@/test/fixtures.ts";
import { ProductFormHarness } from "@/test/products-form.tsx";
import { formValues } from "@/test/products-stock.ts";
import { renderRoute } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { ProductVariantsStep } from "./ProductVariantsStep.tsx";

// The variants step's artikel 05 parts, driven by `loaded` (the variants
// as the form loaded them): the stock at load time, the total, the stock
// badges, and the variants a save would archive, with "Batalkan".

const loadedValues = (): ProductInput =>
  formValues({
    variants: [
      adminVariant(1, { name: "M", sku: "KAOS-M", stock: 12 }),
      adminVariant(2, { name: "L", sku: "KAOS-L", stock: 3 }),
      adminVariant(3, { name: "XL", sku: "KAOS-XL", stock: 0 }),
    ],
  });

const renderStep = (
  values: ProductInput = loadedValues(),
  mode: "create" | "edit" = "edit",
) => {
  renderRoute(
    <ProductFormHarness values={values}>
      <ProductVariantsStep
        mode={mode}
        loaded={mode === "edit" ? values.variants : []}
      />
    </ProductFormHarness>,
  );
  return userEvent.setup();
};

const fieldset = (n: number) =>
  screen.getByRole("group", { name: new RegExp(`^Varian ${String(n)}\\b`) });
const archiveList = () =>
  screen.queryByRole("region", { name: "Varian yang akan diarsipkan" });

describe("ProductVariantsStep with loaded variants", () => {
  it("shows each existing variant's stock when the form loaded it", async () => {
    const user = renderStep();
    const stock = within(fieldset(1)).getByLabelText("Stok");

    expect(stock).toHaveAccessibleDescription("Saat dibuka: 12.");
    await user.clear(stock);
    await user.type(stock, "20");
    expect(stock).toHaveAccessibleDescription("Saat dibuka: 12.");
  });

  it("adds up the stock as typed, ignoring what is not a number", async () => {
    const user = renderStep();

    expect(plain(screen.getByText(/Total stok:/).textContent)).toBe(
      "Total stok: 15 dari 3 varian.",
    );
    const stock = within(fieldset(1)).getByLabelText("Stok");
    await user.clear(stock);
    await user.type(stock, "1.000");
    expect(plain(screen.getByText(/Total stok:/).textContent)).toBe(
      "Total stok: 1.003 dari 3 varian.",
    );
    await user.clear(stock);
    await user.type(stock, "abc");
    expect(plain(screen.getByText(/Total stok:/).textContent)).toBe(
      "Total stok: 3 dari 3 varian.",
    );
  });

  it("badges a variant running low or out of stock in its legend", () => {
    renderStep();

    expect(
      within(fieldset(1)).queryByText(/^Stok (habis|menipis)$/),
    ).toBeNull();
    expect(within(fieldset(2)).getByText("Stok menipis")).toBeInTheDocument();
    expect(within(fieldset(3)).getByText("Stok habis")).toBeInTheDocument();
  });

  it("gives a new variant no load-time stock", async () => {
    const user = renderStep();

    await user.click(screen.getByRole("button", { name: "Tambah varian" }));

    expect(
      within(fieldset(4)).getByLabelText("Stok"),
    ).not.toHaveAccessibleDescription();
  });

  it("lists a removed existing variant as archived on save, and says so", async () => {
    const user = renderStep();

    await user.click(
      within(fieldset(1)).getByRole("button", { name: "Hapus Varian 1" }),
    );

    const list = archiveList();
    expect(list).not.toBeNull();
    expect(plain(list?.textContent)).toContain("M (KAOS-M), stok 12");
    expect(
      screen
        .getAllByRole("status")
        .some(
          (s) =>
            s.textContent ===
            "Varian dihapus dari daftar dan akan diarsipkan saat disimpan.",
        ),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Tambah varian" })).toHaveFocus();
    expect(plain(screen.getByText(/Total stok:/).textContent)).toBe(
      "Total stok: 3 dari 2 varian.",
    );
  });

  it("puts a removed variant back where it was loaded, as it was loaded", async () => {
    const user = renderStep();
    const name = within(fieldset(1)).getByLabelText("Nama varian");
    await user.clear(name);
    await user.type(name, "M diubah");
    await user.click(
      within(fieldset(1)).getByRole("button", { name: "Hapus Varian 1" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Batalkan penghapusan varian M" }),
    );

    expect(archiveList()).toBeNull();
    expect(within(fieldset(1)).getByLabelText("Nama varian")).toHaveValue("M");
    expect(within(fieldset(2)).getByLabelText("Nama varian")).toHaveValue("L");
    expect(
      screen
        .getAllByRole("status")
        .some((s) => s.textContent === "Varian dikembalikan ke daftar."),
    ).toBe(true);
  });

  it("puts a variant loaded last back at the end", async () => {
    const user = renderStep();
    await user.click(
      within(fieldset(3)).getByRole("button", { name: "Hapus Varian 3" }),
    );
    await user.click(
      within(fieldset(1)).getByRole("button", { name: "Hapus Varian 1" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Batalkan penghapusan varian XL" }),
    );

    expect(within(fieldset(2)).getByLabelText("Nama varian")).toHaveValue("XL");
    expect(plain(archiveList()?.textContent)).toContain("M (KAOS-M)");
    expect(plain(archiveList()?.textContent)).not.toContain("XL");
  });

  it("removes a new variant without listing it", async () => {
    const user = renderStep();
    await user.click(screen.getByRole("button", { name: "Tambah varian" }));

    await user.click(
      within(fieldset(4)).getByRole("button", { name: "Hapus Varian 4" }),
    );

    expect(archiveList()).toBeNull();
    expect(
      screen
        .getAllByRole("status")
        .some((s) => s.textContent === "Varian dihapus dari daftar."),
    ).toBe(true);
  });

  it("explains archiving only when editing", () => {
    renderStep(loadedValues(), "create");

    expect(
      screen.queryByText(
        /diarsipkan saat disimpan: riwayat pesanan tetap utuh/,
      ),
    ).toBeNull();
  });

  it("explains archiving when editing", () => {
    renderStep();

    expect(
      screen.getByText(/diarsipkan saat disimpan: riwayat pesanan tetap utuh/),
    ).toBeInTheDocument();
  });
});
