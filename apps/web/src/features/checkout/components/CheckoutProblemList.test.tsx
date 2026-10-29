import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { problem } from "@/test/checkout-fixtures.ts";
import { cartLine, rupiah } from "@/test/fake-api.ts";
import { CheckoutProblemList } from "./CheckoutProblemList.tsx";

const items = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

describe("CheckoutProblemList", () => {
  it("names each refused line from the cart and says what is wrong", () => {
    render(
      <CheckoutProblemList
        lines={[
          cartLine("v1", { product_name: "Kaos Polos", variant_name: "M" }),
          cartLine("v2", { product_name: "Kemeja", variant_name: "L" }),
          cartLine("v3", { product_name: "Topi", variant_name: "Hitam" }),
          cartLine("v4", { product_name: "Celana", variant_name: "32" }),
        ]}
        problems={[
          problem("v1", { problem: "unavailable" }),
          problem("v2", {
            problem: "insufficient_stock",
            available: 1,
            quantity: 3,
          }),
          problem("v3", { problem: "insufficient_stock", available: 0 }),
          problem("v4", {
            problem: "price_changed",
            price_when_added: { amount: 89_000, currency: "IDR" },
            unit_price: { amount: 99_000, currency: "IDR" },
          }),
        ]}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(items()).toEqual([
      "Kaos Polos (M): sudah tidak dijual. Hapus dari keranjang.",
      "Kemeja (L): stok tersisa 1, Anda memesan 3.",
      "Topi (Hitam): stoknya habis. Hapus dari keranjang.",
      `Celana (32): harganya berubah dari ${rupiah(89_000)} menjadi ${rupiah(99_000)}.`,
    ]);
    expect(
      screen
        .getByRole("link", { name: "Perbaiki di keranjang" })
        .getAttribute("href"),
    ).toBe("/keranjang");
  });

  it("falls back to the SKU for a line the cart no longer has", () => {
    render(
      <CheckoutProblemList
        lines={undefined}
        problems={[problem("v9", { sku: "KAOS-M-09" })]}
      />,
    );

    expect(items()).toEqual([
      "KAOS-M-09: sudah tidak dijual. Hapus dari keranjang.",
    ]);
  });
});
