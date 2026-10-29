import type { Cart } from "@goshop/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody } from "@/test/checkout-fixtures.ts";
import {
  cartLine,
  cartOf,
  cartResponse,
  deferred,
  detailedErrorResponse,
  errorResponse,
  fetchMock,
  requestUrl,
  rupiah,
} from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import { selectCartToken, useCartStore } from "../cart-store.ts";
import { CartPage } from "./CartPage.tsx";

// CartLineItem is rendered by the cart page, which owns the query it
// reads and moves the focus after a removal: tested there, as a buyer
// meets it.
vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

/** What GET /v1/cart answers. */
let serverCart: Cart;
/** How PATCH and DELETE /v1/cart/items/{id} answer; set per test. */
let answerLine: (method: string, body: unknown) => Promise<Response>;

const gtag = vi.fn();
const events = () =>
  gtag.mock.calls
    .filter(([command]) => command === "event")
    .map(([, name]) => name as string);

/** The line requests sent, as "METHOD /path {body}". */
const lineRequests = () =>
  fetchMock.mock.calls
    .filter(([input]) =>
      requestUrl(input).pathname.startsWith("/v1/cart/items/"),
    )
    .map(([input, init]) => ({
      request: `${init?.method ?? "GET"} ${requestUrl(input).pathname}`,
      body: jsonBody(init),
      token: new Headers(init?.headers).get("X-Cart-Token"),
    }));

const renderCart = async (cart: Cart) => {
  serverCart = cart;
  useCartStore.getState().setToken("tok");
  const view = renderWithProviders(<CartPage />, {
    path: "/keranjang",
    url: "/keranjang",
  });
  await screen.findByRole("list", { name: "Barang di keranjang" });
  return view;
};

const lineOf = (name: string) => {
  const item = screen.getByRole("link", { name }).closest("li");
  if (!item) throw new Error(`${name} is not in a line`);
  return item;
};
const quantityOf = (line: HTMLElement) =>
  line.querySelector("output")?.textContent;

beforeEach(() => {
  fetchMock.mockReset();
  gtag.mockReset();
  window.gtag = gtag;
  answerLine = () => Promise.resolve(cartResponse(serverCart));
  fetchMock.mockImplementation((input, init) => {
    const method = init?.method ?? "GET";
    if (requestUrl(input).pathname === "/v1/cart" && method === "GET") {
      return Promise.resolve(cartResponse(serverCart));
    }
    return answerLine(method, jsonBody(init));
  });
});

afterEach(() => {
  delete window.gtag;
});

describe("CartLineItem: the stepper", () => {
  it("+ shows the new quantity at once, then saves it with the guest's token", async () => {
    const user = userEvent.setup();
    const saved = deferred<Response>();
    answerLine = () => saved.promise;
    await renderCart(cartOf([cartLine("m", { quantity: 2 })]));
    const line = lineOf("Produk m");

    await user.click(
      within(line).getByRole("button", { name: "Tambah jumlah Produk m, M" }),
    );

    // The guess, before the API answered.
    expect(quantityOf(line)).toBe("3");
    expect(line.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(/Subtotal/).textContent).toBe(
      `Subtotal (3 barang): ${rupiah(267_000)}`,
    );
    expect(lineRequests()).toEqual([
      {
        request: "PATCH /v1/cart/items/m",
        body: { quantity: 3 },
        token: "tok",
      },
    ]);

    serverCart = cartOf([cartLine("m", { quantity: 3 })]);
    saved.resolve(cartResponse(serverCart));
    await waitFor(() => {
      expect(line.getAttribute("aria-busy")).toBe("false");
    });
    expect(quantityOf(line)).toBe("3");
  });

  it("− lowers the quantity, and is no removal: no analytics event", async () => {
    const user = userEvent.setup();
    await renderCart(cartOf([cartLine("m", { quantity: 2 })]));
    const line = lineOf("Produk m");
    serverCart = cartOf([cartLine("m", { quantity: 1 })]);

    await user.click(
      within(line).getByRole("button", { name: "Kurangi jumlah Produk m, M" }),
    );

    await waitFor(() => {
      expect(line.getAttribute("aria-busy")).toBe("false");
    });
    expect(lineRequests().map((r) => r.body)).toEqual([{ quantity: 1 }]);
    expect(quantityOf(line)).toBe("1");
    expect(events()).toEqual([]);
  });

  it("disables − at 1 and + at the stock", async () => {
    await renderCart(
      cartOf([
        cartLine("m", { quantity: 1 }),
        cartLine("l", { quantity: 3, stock: 3 }),
      ]),
    );

    const one = lineOf("Produk m");
    expect(
      within(one)
        .getByRole("button", { name: "Kurangi jumlah Produk m, M" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(one)
        .getByRole("button", { name: "Tambah jumlah Produk m, M" })
        .hasAttribute("disabled"),
    ).toBe(false);
    const full = lineOf("Produk l");
    expect(
      within(full)
        .getByRole("button", { name: "Tambah jumlah Produk l, L" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("disables + at 99 even with more in stock", async () => {
    await renderCart(cartOf([cartLine("m", { quantity: 99, stock: 500 })]));

    expect(
      screen
        .getByRole("button", { name: "Tambah jumlah Produk m, M" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("puts the quantity back and says why when the API refuses it", async () => {
    const user = userEvent.setup();
    answerLine = () =>
      Promise.resolve(
        detailedErrorResponse(409, "INSUFFICIENT_STOCK", { available: 2 }),
      );
    await renderCart(cartOf([cartLine("m", { quantity: 2 })]));
    const line = lineOf("Produk m");

    await user.click(
      within(line).getByRole("button", { name: "Tambah jumlah Produk m, M" }),
    );

    const alert = await within(line).findByRole("alert");
    expect(alert.textContent).toBe("Stok tidak cukup. Tersedia 2.");
    expect(quantityOf(line)).toBe("2");
    // The remove button names the error, so its reason is read with it.
    expect(
      within(line)
        .getByRole("button", { name: "Hapus Produk m, M" })
        .getAttribute("aria-describedby"),
    ).toBe(alert.id);
  });
});

describe("CartLineItem: removing a line", () => {
  it("keeps the line, busy, until the API confirms, then reports remove_from_cart", async () => {
    const user = userEvent.setup();
    const removed = deferred<Response>();
    answerLine = () => removed.promise;
    await renderCart(cartOf([cartLine("m", { quantity: 2 }), cartLine("l")]));
    const line = lineOf("Produk m");

    await user.click(
      within(line).getByRole("button", { name: "Hapus Produk m, M" }),
    );

    expect(within(line).getByText("Menghapus…")).toBeTruthy();
    expect(
      within(line)
        .getByRole("button", { name: "Tambah jumlah Produk m, M" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(lineRequests()).toEqual([
      { request: "DELETE /v1/cart/items/m", body: undefined, token: "tok" },
    ]);
    expect(events()).toEqual([]);

    serverCart = cartOf([cartLine("l")]);
    removed.resolve(cartResponse(serverCart));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Produk m" })).toBeNull();
    });
    expect(
      screen
        .getByText("Produk m (M) dihapus dari keranjang.")
        .getAttribute("role"),
    ).toBe("status");
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1, name: "Keranjang" }),
    );
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "remove_from_cart",
      expect.objectContaining({
        value: 178_000,
        items: [expect.objectContaining({ item_id: "SKU-M", quantity: 2 })],
      }),
    );
    expect(events()).toEqual(["remove_from_cart"]);
  });

  it("shows a failed removal on its line, sending no event", async () => {
    const user = userEvent.setup();
    answerLine = () => Promise.resolve(errorResponse(500, "INTERNAL_ERROR"));
    await renderCart(cartOf([cartLine("m")]));
    const line = lineOf("Produk m");

    await user.click(
      within(line).getByRole("button", { name: "Hapus Produk m, M" }),
    );

    expect((await within(line).findByRole("alert")).textContent).toBe(
      "Keranjang belum berubah. Coba lagi.",
    );
    expect(within(line).getByText("Hapus")).toBeTruthy();
    expect(events()).toEqual([]);
  });

  it("forgets a guest cart the API no longer knows, without asking for it again", async () => {
    const user = userEvent.setup();
    answerLine = () => Promise.resolve(errorResponse(404, "CART_NOT_FOUND"));
    await renderCart(cartOf([cartLine("m", { quantity: 2 })]));
    const gets = () =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          requestUrl(input).pathname === "/v1/cart" &&
          (init?.method ?? "GET") === "GET",
      ).length;
    const getsBefore = gets();

    await user.click(
      screen.getByRole("button", { name: "Tambah jumlah Produk m, M" }),
    );

    await waitFor(() => {
      expect(selectCartToken(useCartStore.getState())).toBeNull();
    });
    expect(gets()).toBe(getsBefore);
  });
});

describe("CartLineItem: fixing a problem", () => {
  it("Pakai harga baru saves the same quantity, then moves the focus to the product", async () => {
    const user = userEvent.setup();
    await renderCart(
      cartOf([
        cartLine("m", {
          quantity: 2,
          problem: "price_changed",
          unit_price: { amount: 95_000, currency: "IDR" },
          price_when_added: { amount: 89_000, currency: "IDR" },
        }),
      ]),
    );
    expect(screen.getByText(/^Sebelumnya/).textContent).toBe(
      `Sebelumnya ${rupiah(89_000)}`,
    );
    serverCart = cartOf([
      cartLine("m", {
        quantity: 2,
        unit_price: { amount: 95_000, currency: "IDR" },
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Pakai harga baru" }));

    await waitFor(() => {
      expect(screen.queryByText("Harga berubah")).toBeNull();
    });
    expect(lineRequests().map((r) => r.body)).toEqual([{ quantity: 2 }]);
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Produk m" }),
    );
  });

  it("Ubah jadi N lowers the quantity to the stock", async () => {
    const user = userEvent.setup();
    await renderCart(
      cartOf([
        cartLine("m", { quantity: 5, stock: 3, problem: "insufficient_stock" }),
      ]),
    );
    serverCart = cartOf([cartLine("m", { quantity: 3, stock: 3 })]);

    await user.click(screen.getByRole("button", { name: "Ubah jadi 3" }));

    await waitFor(() => {
      expect(screen.queryByText("Stok tidak cukup")).toBeNull();
    });
    expect(lineRequests().map((r) => r.body)).toEqual([{ quantity: 3 }]);
    expect(quantityOf(lineOf("Produk m"))).toBe("3");
  });

  it("offers no quantity fix when the stock ran out: only Hapus helps", async () => {
    await renderCart(
      cartOf([
        cartLine("m", { quantity: 2, stock: 0, problem: "insufficient_stock" }),
        cartLine("l", { problem: "unavailable" }),
      ]),
    );

    expect(screen.queryByRole("button", { name: /Ubah jadi/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pakai harga baru" }),
    ).toBeNull();
    // The stepper never offers below 1, even with no stock.
    expect(
      screen
        .getByRole("button", { name: "Tambah jumlah Produk m, M" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("Sudah tidak dijual")).toBeTruthy();
  });
});
