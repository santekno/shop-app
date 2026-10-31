import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import type { Product } from "@goshop/shared";

import { product } from "@/test/fixtures";
import { ProductCard } from "./ProductCard";

// The real ProductPhoto, counted: memo(ProductCard) is observable as the
// photo not rendering again when the card's props did not change.
const mockPhotoRenders = jest.fn();
jest.mock("./ProductPhoto", () => {
  const actual =
    jest.requireActual<typeof import("./ProductPhoto")>("./ProductPhoto");
  return {
    ProductPhoto: (props: Parameters<typeof actual.ProductPhoto>[0]) => {
      mockPhotoRenders();
      return actual.ProductPhoto(props);
    },
  };
});

afterEach(() => {
  mockPhotoRenders.mockClear();
});

const noop = () => undefined;

/** A product whose variants cost `amounts`, the cheapest as price_from. */
const withPrices = (name: string, amounts: number[]): Product => {
  const base = product(name, {
    price_from: { amount: Math.min(...amounts), currency: "IDR" },
  });
  return {
    ...base,
    variants: amounts.map((amount, i) => ({
      id: `00000000-0000-4000-8000-1000000000${String(i).padStart(2, "0")}`,
      sku: `v-${i}`,
      name: `V${i}`,
      price: { amount, currency: "IDR" },
      stock: 3,
    })),
  };
};

describe("ProductCard", () => {
  it("shows one price when every variant costs the same", async () => {
    await render(
      <ProductCard
        product={withPrices("Kaos Polos", [89_000, 89_000])}
        onPress={noop}
      />,
    );

    expect(screen.getByText("Kaos Polos")).toBeOnTheScreen();
    expect(screen.getByText("Rp 89.000")).toBeOnTheScreen();
    expect(screen.queryByText(/Mulai/)).not.toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Kaos Polos, Rp 89.000" }),
    ).toBeOnTheScreen();
  });

  it("says Mulai when another variant costs more", async () => {
    await render(
      <ProductCard
        product={withPrices("Hoodie", [150_000, 175_000])}
        onPress={noop}
      />,
    );

    expect(screen.getByText("Mulai Rp 150.000")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Hoodie, mulai Rp 150.000" }),
    ).toBeOnTheScreen();
  });

  it("compares amounts, not objects: equal prices in new objects are one price", async () => {
    const p = withPrices("Topi", [50_000]);
    await render(
      <ProductCard
        product={{ ...p, price_from: { amount: 50_000, currency: "IDR" } }}
        onPress={noop}
      />,
    );

    expect(screen.queryByText(/Mulai/)).not.toBeOnTheScreen();
  });

  it("marks a product out of stock with a badge and in its label", async () => {
    await render(
      <ProductCard
        product={product("Jaket", { in_stock: false })}
        onPress={noop}
      />,
    );

    expect(screen.getByText("Stok habis")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Jaket, Rp 89.000, stok habis" }),
    ).toBeOnTheScreen();
  });

  it("has no badge while the product is in stock", async () => {
    await render(<ProductCard product={product("Jaket")} onPress={noop} />);

    expect(screen.queryByText("Stok habis")).not.toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Jaket, Rp 89.000" }),
    ).toBeOnTheScreen();
  });

  it("tells a screen reader what a tap does", async () => {
    await render(<ProductCard product={product("Jaket")} onPress={noop} />);

    expect(screen.getByRole("button")).toHaveProp(
      "accessibilityHint",
      "Membuka halaman produk",
    );
  });

  it("hands the tapped product to onPress", async () => {
    const onPress = jest.fn();
    const kaos = product("Kaos Polos");
    await render(<ProductCard product={kaos} onPress={onPress} />);

    await userEvent.press(screen.getByRole("button"));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(kaos);
  });

  it("cuts a long name after two lines", async () => {
    const name = "Kaos Polos Lengan Panjang Katun Combed 30s Warna Hitam Pekat";
    await render(<ProductCard product={product(name)} onPress={noop} />);

    expect(screen.getByText(name)).toHaveProp("numberOfLines", 2);
  });

  it("draws the first photo, or the placeholder without one", async () => {
    await render(<ProductCard product={product("Kaos")} onPress={noop} />);
    expect(screen.getByText("Belum ada foto")).toBeOnTheScreen();
  });

  it("skips rendering again when the product and onPress are the same (memo)", async () => {
    const kaos = product("Kaos");
    await render(<ProductCard product={kaos} onPress={noop} />);
    expect(mockPhotoRenders).toHaveBeenCalledTimes(1);

    await screen.rerender(<ProductCard product={kaos} onPress={noop} />);
    expect(mockPhotoRenders).toHaveBeenCalledTimes(1);

    await screen.rerender(
      <ProductCard product={{ ...kaos, name: "Kaos Baru" }} onPress={noop} />,
    );
    expect(mockPhotoRenders).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Kaos Baru")).toBeOnTheScreen();
  });
});
