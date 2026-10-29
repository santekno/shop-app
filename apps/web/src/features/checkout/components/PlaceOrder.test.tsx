import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { apiError, problem } from "@/test/checkout-fixtures.ts";
import { cartLine } from "@/test/fake-api.ts";
import { PlaceOrder } from "./PlaceOrder.tsx";

const button = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: /Buat pesanan & bayar|Memproses pesanan…/,
  });

describe("PlaceOrder", () => {
  it("places the order when nothing is missing", async () => {
    const onPlace = vi.fn();
    render(
      <PlaceOrder
        blockedBy={null}
        busy={false}
        error={null}
        cartLines={[]}
        onPlace={onPlace}
      />,
    );

    expect(button().textContent).toBe("Buat pesanan & bayar");
    expect(button().disabled).toBe(false);
    expect(button().getAttribute("aria-describedby")).toBeNull();
    await userEvent.setup().click(button());

    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is disabled with its reason as the description while something is missing", () => {
    render(
      <PlaceOrder
        blockedBy="Pilih alamat dan kurir dulu."
        busy={false}
        error={null}
        cartLines={[]}
        onPlace={vi.fn()}
      />,
    );

    expect(button().disabled).toBe(true);
    const reasonId = button().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(
      "Pilih alamat dan kurir dulu.",
    );
  });

  it("says the order is being processed and cannot be pressed again", async () => {
    const onPlace = vi.fn();
    render(
      <PlaceOrder
        blockedBy={null}
        busy
        error={null}
        cartLines={[]}
        onPlace={onPlace}
      />,
    );

    expect(button().textContent).toBe("Memproses pesanan…");
    expect(button().disabled).toBe(true);
    await userEvent.setup().click(button());
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("shows an error, focused, and links to the unpaid orders for TOO_MANY_PENDING_ORDERS", () => {
    render(
      <PlaceOrder
        blockedBy={null}
        busy={false}
        error={apiError(409, "TOO_MANY_PENDING_ORDERS")}
        cartLines={[]}
        onPlace={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "Anda sudah punya 5 pesanan yang belum dibayar. Bayar atau batalkan salah satunya dulu.",
    );
    expect(document.activeElement).toBe(alert);
    expect(
      screen
        .getByRole("link", { name: "Lihat pesanan Anda yang belum dibayar" })
        .getAttribute("href"),
    ).toBe("/pesanan");
  });

  it("shows another error without the orders link", () => {
    render(
      <PlaceOrder
        blockedBy={null}
        busy={false}
        error={apiError(409, "CART_EMPTY")}
        cartLines={[]}
        onPlace={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Keranjang Anda kosong. Tambahkan barang dulu.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("lists the refused lines for CHECKOUT_PROBLEMS instead of a sentence", () => {
    render(
      <PlaceOrder
        blockedBy={null}
        busy={false}
        error={apiError(409, "CHECKOUT_PROBLEMS", {
          lines: [problem("v1")],
        })}
        cartLines={[
          cartLine("v1", { product_name: "Kaos Polos", variant_name: "M" }),
        ]}
        onPlace={vi.fn()}
      />,
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(screen.getByRole("listitem").textContent).toBe(
      "Kaos Polos (M): sudah tidak dijual. Hapus dari keranjang.",
    );
  });
});
