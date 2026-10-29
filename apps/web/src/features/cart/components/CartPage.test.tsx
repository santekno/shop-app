import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartLine,
  cartOf,
  cartResponse,
  errorResponse,
  fetchMock,
  rupiah,
} from "@/test/fake-api.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { useCartStore } from "../cart-store.ts";
import { CartPage } from "./CartPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const EXPIRED_TEXT =
  "Keranjang Anda sebelumnya sudah tidak berlaku, jadi sekarang kosong.";

/** The cart page, with a guest cart token in place as the first add would. */
const renderCart = (withToken = true) => {
  if (withToken) useCartStore.getState().setToken("tok");
  return renderWithProviders(<CartPage />, {
    path: "/keranjang",
    url: "/keranjang",
  });
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("CartPage", () => {
  it("shows an empty cart to a guest without one, with a link to the catalog", async () => {
    const user = userEvent.setup();
    renderCart(false);

    expect(
      screen.getByRole("heading", { level: 1, name: "Keranjang" }),
    ).toBeTruthy();
    expect(
      await screen.findByText("Keranjang Anda masih kosong."),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "Lihat katalog" }));
    expect(currentLocation()).toBe("/");
  });

  it("lists the lines, each linking to its product, with the subtotal", async () => {
    fetchMock.mockResolvedValue(
      cartResponse(
        cartOf([
          cartLine("m", {
            quantity: 2,
            product_name: "Kaos Polos",
            product_slug: "kaos-polos",
          }),
          cartLine("l", {
            quantity: 1,
            product_name: "Kemeja",
            product_slug: "kemeja",
          }),
        ]),
      ),
    );
    renderCart();

    const lines = await screen.findAllByRole("listitem");
    expect(lines).toHaveLength(2);
    const [first] = lines;
    if (!first) throw new Error("no first line");
    expect(
      within(first)
        .getByRole("link", { name: "Kaos Polos" })
        .getAttribute("href"),
    ).toBe("/produk/kaos-polos");
    expect(first.textContent).toContain(`M · 2 × ${rupiah(89_000)}`);
    expect(first.textContent).toContain(rupiah(178_000));
    expect(screen.getByText(/Subtotal \(3 barang\)/).textContent).toBe(
      `Subtotal (3 barang): ${rupiah(267_000)}`,
    );
  });

  it.each([
    ["unavailable", "Sudah tidak dijual"],
    ["insufficient_stock", "Stok tidak cukup"],
    ["price_changed", "Harga berubah"],
  ] as const)("marks a line whose problem is %s", async (problem, text) => {
    fetchMock.mockResolvedValue(
      cartResponse(cartOf([cartLine("m", { problem }), cartLine("l")])),
    );
    renderCart();

    const badge = await screen.findByText(text);
    expect(badge.classList.contains("badge")).toBe(true);
    // The destructive look: a problem, not a count.
    expect(badge.classList.contains("text-destructive")).toBe(true);
    expect(
      screen.getAllByText(/Sudah tidak dijual|Stok tidak cukup|Harga berubah/),
    ).toHaveLength(1);
  });

  it("shows a failed load with Coba lagi, which loads it again", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR"))
      .mockResolvedValueOnce(cartResponse(cartOf([cartLine("m")])));
    renderCart();

    const alert = await screen.findByRole("alert");
    await act(() =>
      user.click(within(alert).getByRole("button", { name: "Coba lagi" })),
    );

    expect(await screen.findByRole("listitem")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says Memuat keranjang… while it loads", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderCart();

    return vi.waitFor(() => {
      expect(screen.getByText("Memuat keranjang…").getAttribute("role")).toBe(
        "status",
      );
    });
  });

  it("shows an empty cart, not an error, when the cart is gone", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "CART_NOT_FOUND"));
    renderCart();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Keranjang Anda masih kosong."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useCartStore.getState().token).toBeNull();
  });

  it("says why the cart is empty when it expired, until Tutup", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(errorResponse(404, "CART_NOT_FOUND"));
    renderCart();

    const notice = await screen.findByText(EXPIRED_TEXT);
    // The live region that was there before the text arrived.
    expect(notice.getAttribute("role")).toBe("status");
    expect(useCartStore.getState().cartExpired).toBe(true);

    await user.click(screen.getByRole("button", { name: "Tutup" }));

    expect(screen.queryByText(EXPIRED_TEXT)).toBeNull();
    expect(screen.queryByRole("button", { name: "Tutup" })).toBeNull();
    expect(useCartStore.getState().cartExpired).toBe(false);
    // The live region stays, empty, for the next time.
    expect(
      screen.getAllByRole("status").some((region) => region.textContent === ""),
    ).toBe(true);
  });

  it("says nothing about an expired cart while the cart is fine", async () => {
    fetchMock.mockResolvedValue(cartResponse(cartOf([cartLine("m")])));
    renderCart();

    expect(await screen.findByRole("listitem")).toBeTruthy();
    expect(screen.queryByText(EXPIRED_TEXT)).toBeNull();
    expect(screen.queryByRole("button", { name: "Tutup" })).toBeNull();
  });
});
