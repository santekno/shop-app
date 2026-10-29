import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { preview, quote, voucher } from "@/test/checkout-fixtures.ts";
import { cartLine, rupiah } from "@/test/fake-api.ts";
import { OrderSummary } from "./OrderSummary.tsx";

/** The summary's totals as [term, value] pairs. */
const totals = (container: HTMLElement) => {
  const terms = [...container.querySelectorAll("dt")].map(
    (dt) => dt.textContent,
  );
  const values = [...container.querySelectorAll("dd")].map(
    (dd) => dd.textContent,
  );
  return terms.map((term, i) => [term, values[i]]);
};

describe("OrderSummary", () => {
  it("shows the lines and the API's totals, without a voucher or courier yet", () => {
    const { container } = render(
      <OrderSummary
        preview={preview(
          [
            cartLine("v1", {
              product_name: "Kaos Polos",
              variant_name: "M",
              quantity: 2,
            }),
          ],
          // A total the browser would not get by adding: the page shows it as sent.
          { subtotal: 178_000, total: 178_001 },
        )}
        updating={false}
      />,
    );

    const list = screen.getByRole("list", { name: "Barang yang dipesan" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([`Kaos Polos (M) × 2${rupiah(178_000)}`]);
    expect(totals(container)).toEqual([
      ["Subtotal", rupiah(178_000)],
      ["Ongkos kirim", "Pilih kurir"],
      ["Total", rupiah(178_001)],
    ]);
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it("adds the voucher's discount and the courier's fee", () => {
    const { container } = render(
      <OrderSummary
        preview={preview([cartLine("v1")], {
          subtotal: 89_000,
          discount: 15_000,
          shippingFee: 18_000,
          shipping: quote(),
          voucher: voucher(),
        })}
        updating={false}
      />,
    );

    expect(totals(container)).toEqual([
      ["Subtotal", rupiah(89_000)],
      ["Diskon voucher POTONG15RB", `−${rupiah(15_000)}`],
      ["Ongkos kirim (JNE Reguler)", rupiah(18_000)],
      ["Total", rupiah(92_000)],
    ]);
  });

  it("marks the last numbers busy and dimmed while a new preview loads", () => {
    const { container } = render(
      <OrderSummary preview={preview([cartLine("v1")])} updating />,
    );

    const root = container.firstElementChild;
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(root?.className).toContain("opacity-60");
  });
});
