import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { formatRupiah } from "@goshop/shared";
import type { ProductVariant } from "@goshop/shared";

import { VariantPicker } from "./VariantPicker";

const variant = (
  name: string,
  stock: number,
  amount = 89_000,
): ProductVariant => ({
  id: `id-${name}`,
  sku: name,
  name,
  price: { amount, currency: "IDR" },
  stock,
});

const price = (amount: number) => formatRupiah({ amount, currency: "IDR" });

describe("VariantPicker", () => {
  it("draws nothing when the product has no variant", async () => {
    const { toJSON } = await render(
      <VariantPicker
        variants={[]}
        selectedId={undefined}
        onSelect={jest.fn()}
      />,
    );

    expect(toJSON()).toBeNull();
  });

  it("is a radio group titled 'Pilih varian' with one radio per variant, the selected one checked", async () => {
    await render(
      <VariantPicker
        variants={[variant("M", 3), variant("L", 4, 99_000)]}
        selectedId="id-L"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByRole("header", { name: "Pilih varian" })).toBeTruthy();
    expect(
      screen.container.queryAll(
        (i) => i.props.accessibilityRole === "radiogroup",
      ),
    ).toHaveLength(1);
    expect(
      screen.getByRole("radio", {
        name: `M, ${price(89_000)}`,
        checked: false,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: `L, ${price(99_000)}`, checked: true }),
    ).toBeTruthy();
  });

  it("choosing an available variant calls onSelect with it", async () => {
    const onSelect = jest.fn<(v: ProductVariant) => void>();
    const m = variant("M", 3);
    const l = variant("L", 4);
    await render(
      <VariantPicker variants={[m, l]} selectedId="id-M" onSelect={onSelect} />,
    );

    await userEvent.press(
      screen.getByRole("radio", { name: `L, ${price(89_000)}` }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(l);
  });

  it("a sold-out variant says so, is disabled, and does nothing when pressed", async () => {
    const onSelect = jest.fn<(v: ProductVariant) => void>();
    await render(
      <VariantPicker
        variants={[variant("M", 3), variant("XL", 0)]}
        selectedId="id-M"
        onSelect={onSelect}
      />,
    );

    const soldOut = screen.getByRole("radio", {
      name: `XL, ${price(89_000)}, stok habis`,
    });
    expect(soldOut).toBeDisabled();
    expect(screen.getByText("Habis")).toBeTruthy();
    await userEvent.press(soldOut);

    expect(onSelect).not.toHaveBeenCalled();
  });
});
