import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { currentLocation, inRouter } from "@/test/render.tsx";
import { EmptyCart } from "./EmptyCart.tsx";

describe("EmptyCart", () => {
  it("says the cart is empty, with a link that looks like a button to the catalog", async () => {
    const events = userEvent.setup();
    render(inRouter(<EmptyCart />, undefined, "/keranjang"));

    expect(screen.getByText("Keranjang Anda masih kosong.")).toBeTruthy();
    expect(
      screen.getByText("Jelajahi katalog dan tambahkan produk yang Anda suka."),
    ).toBeTruthy();
    // A link, not a button: it goes to another page.
    const link = screen.getByRole("link", { name: "Lihat katalog" });
    expect(link.getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button")).toBeNull();

    await events.click(link);
    expect(currentLocation()).toBe("/");
  });

  it("is no landmark or heading of its own inside the cart page's card", () => {
    const { container } = render(inRouter(<EmptyCart />));

    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    // The icon is decoration: hidden from screen readers.
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});
