import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartLine,
  cartOf,
  cartResponse,
  deferred,
  detailedErrorResponse,
  fetchMock,
} from "@/test/fake-api.ts";
import { currentLocation, inRouter } from "@/test/render.tsx";
import { AddToCart } from "./AddToCart.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const PRICE = { amount: 89_000, currency: "IDR" } as const;
const button = () => screen.getByRole("button");

beforeEach(() => {
  fetchMock.mockReset();
});

describe("AddToCart", () => {
  it("renders the live region before anything happens", () => {
    render(
      inRouter(<AddToCart variantId="m" unitPrice={PRICE} quantity={2} />),
    );

    expect(button().textContent).toBe("Tambah ke keranjang");
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds the chosen quantity, one add at a time, then says so with a link to the cart", async () => {
    const user = userEvent.setup();
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    render(
      inRouter(<AddToCart variantId="m" unitPrice={PRICE} quantity={2} />),
    );

    await user.click(button());

    expect(button().textContent).toBe("Menambahkan…");
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      '{"variant_id":"m","quantity":2}',
    );
    answer.resolve(
      cartResponse(cartOf([cartLine("m", { quantity: 2 })]), "tok", 201),
    );
    expect(await screen.findByText(/Ditambahkan ke keranjang\./)).toBe(
      screen.getByRole("status"),
    );
    expect((button() as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole("link", { name: "Lihat keranjang" }));
    expect(currentLocation()).toBe("/keranjang");
  });

  it("says why the add failed in an alert", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      detailedErrorResponse(409, "INSUFFICIENT_STOCK", { available: 1 }),
    );
    // The cart is fetched again after the error.
    fetchMock.mockResolvedValue(cartResponse(cartOf([])));
    render(
      inRouter(<AddToCart variantId="m" unitPrice={PRICE} quantity={5} />),
    );

    await user.click(button());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Stok tidak cukup. Tersedia 1, termasuk yang sudah ada di keranjang Anda.",
    );
    expect(screen.getByRole("status").textContent).toBe("");
    expect(button().textContent).toBe("Tambah ke keranjang");
  });
});
