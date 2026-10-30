import type { ProductInput } from "@goshop/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFormContext } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { adminVariant } from "@/test/fixtures.ts";
import { ProductFormHarness } from "@/test/products-form-conflict.tsx";
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

  describe("a stock above 1.000.000", () => {
    const OVER_MAX =
      'Stok paling banyak 1.000.000. Stok di server melewatinya karena pesanan yang dibatalkan mengembalikan unitnya. Tulis stok yang benar di sini, atau kurangi lewat "Ubah stok" di bagian Stok.';
    const RANGE = "Stok antara 0 dan 1.000.000.";

    /** What "Lanjut" does: the form's schema checks every field. */
    function Check() {
      const { trigger } = useFormContext<ProductInput>();
      return (
        <button type="button" onClick={() => void trigger()}>
          Periksa
        </button>
      );
    }

    /** The step with one existing variant whose stock loaded as `stock`. */
    const renderLoaded = (stock: number) => {
      const values = formValues({
        variants: [adminVariant(1, { name: "M", sku: "KAOS-M", stock })],
      });
      renderRoute(
        <ProductFormHarness values={values}>
          <ProductVariantsStep mode="edit" loaded={values.variants} />
          <Check />
        </ProductFormHarness>,
      );
      return userEvent.setup();
    };

    const stockOf = (n: number) => within(fieldset(n)).getByLabelText("Stok");
    const check = (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByRole("button", { name: "Periksa" }));
    const retype = async (
      user: ReturnType<typeof userEvent.setup>,
      n: number,
      value: string,
    ) => {
      await user.clear(stockOf(n));
      await user.type(stockOf(n), value);
    };

    it("says why a loaded stock above it fails, and what to do", async () => {
      const user = renderLoaded(1_000_005);
      // Nothing before the form is checked, like any other field.
      expect(stockOf(1)).toHaveAccessibleDescription("Saat dibuka: 1.000.005.");

      await check(user);

      expect(stockOf(1)).toHaveAccessibleDescription(
        `Saat dibuka: 1.000.005. ${OVER_MAX}`,
      );
      expect(stockOf(1)).toHaveAttribute("aria-invalid", "true");
    });

    it("says the same when the seller types a number still above it", async () => {
      const user = renderLoaded(1_000_005);

      await retype(user, 1, "2000000");
      await check(user);

      expect(within(fieldset(1)).getByText(OVER_MAX)).toBeInTheDocument();
    });

    it("has nothing to say once the seller writes a stock within it", async () => {
      const user = renderLoaded(1_000_005);

      await retype(user, 1, "999");
      await check(user);

      expect(stockOf(1)).toHaveAccessibleDescription("Saat dibuka: 1.000.005.");
      expect(stockOf(1)).not.toHaveAttribute("aria-invalid");
    });

    it("keeps the schema's own message for a stock that is not a number", async () => {
      const user = renderLoaded(1_000_005);

      await retype(user, 1, "abc");
      await check(user);

      expect(
        within(fieldset(1)).getByText(
          "Tulis stok sebagai bilangan bulat, misalnya 12.",
        ),
      ).toBeInTheDocument();
      expect(within(fieldset(1)).queryByText(OVER_MAX)).toBeNull();
    });

    it("keeps the plain range for a stock typed above it that loaded within it", async () => {
      const user = renderLoaded(12);

      await retype(user, 1, "2000000");
      await check(user);

      expect(within(fieldset(1)).getByText(RANGE)).toBeInTheDocument();
      expect(within(fieldset(1)).queryByText(OVER_MAX)).toBeNull();
    });

    it("keeps the plain range for a new variant typed above it", async () => {
      const user = renderLoaded(1_000_005);
      await retype(user, 1, "10");
      await user.click(screen.getByRole("button", { name: "Tambah varian" }));
      await user.type(within(fieldset(2)).getByLabelText("Stok"), "2000000");

      await check(user);

      expect(within(fieldset(2)).getByText(RANGE)).toBeInTheDocument();
      expect(screen.queryByText(OVER_MAX)).toBeNull();
    });
  });
});
