// Helpers for the product form's tests (Bab 12 artikel 03): the pages
// around it, and filling its steps the way a seller does.
import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { CATEGORY_ID, category } from "./fixtures.ts";

/** The categories the form offers: a parent and its child. */
export const formCategories = [
  category(CATEGORY_ID, "Kaos"),
  category("66666666-6666-4666-8666-000000000001", "Pakaian"),
  category(
    "66666666-6666-4666-8666-000000000002",
    "Kemeja",
    "66666666-6666-4666-8666-000000000001",
  ),
];

/** Fills "Info dasar": name, category, and status when given. */
export const fillInfo = async (
  user: UserEvent,
  {
    name = "Kaos Polos Hitam",
    categoryName = "Kaos",
    status,
  }: {
    name?: string;
    categoryName?: string;
    status?: string;
  } = {},
) => {
  await user.type(screen.getByLabelText("Nama produk"), name);
  await user.selectOptions(screen.getByLabelText("Kategori"), categoryName);
  if (status !== undefined) {
    await user.selectOptions(screen.getByLabelText("Status"), status);
  }
};

/** Fills the variant at `index` (0-based): SKU, name, price, stock, weight. */
export const fillVariant = async (
  user: UserEvent,
  index: number,
  {
    sku = "kph-m",
    name = "M",
    price = "89.000",
    stock = "12",
    weight = "250",
  }: {
    sku?: string;
    name?: string;
    price?: string;
    stock?: string;
    weight?: string;
  } = {},
) => {
  const nth = (label: string) => {
    const field = screen.getAllByLabelText(label)[index];
    if (field === undefined)
      throw new Error(`no ${label} for variant ${String(index + 1)}`);
    return field;
  };
  for (const [label, value] of [
    ["SKU", sku],
    ["Nama varian", name],
    ["Harga (Rp)", price],
    ["Stok", stock],
    ["Berat (gram)", weight],
  ] as const) {
    await user.clear(nth(label));
    if (value !== "") await user.type(nth(label), value);
  }
};

/** The form's step heading (an <h2>), by its title. */
export const stepHeading = (title: string) =>
  screen.getByRole("heading", { level: 2, name: title });
