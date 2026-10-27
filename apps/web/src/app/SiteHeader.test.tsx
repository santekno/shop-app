import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { SiteHeader } from "./SiteHeader.tsx";

const nav = () => screen.getByRole("navigation", { name: "Utama" });

describe("SiteHeader", () => {
  it("shows the GoShop brand as a link to the catalog, inside the banner", () => {
    renderWithProviders(<SiteHeader />);

    const brand = screen.getByRole("link", { name: "GoShop" });
    expect(brand.getAttribute("href")).toBe("/");
    expect(screen.getByRole("banner").contains(brand)).toBe(true);
    expect(
      screen.getByText("Toko online contoh dari kursus Fullstack Santekno."),
    ).toBeTruthy();
  });

  it("links to the cart and the account pages in the main navigation", () => {
    renderWithProviders(<SiteHeader />);

    const links = within(nav()).getAllByRole("link");
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Keranjang", "/keranjang"],
      ["Masuk", "/masuk"],
      ["Daftar", "/daftar"],
    ]);
  });

  it("marks the link of the current page with aria-current", () => {
    renderWithProviders(<SiteHeader />, { url: "/masuk" });

    expect(
      within(nav())
        .getByRole("link", { name: "Masuk" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(nav())
        .getByRole("link", { name: "Daftar" })
        .hasAttribute("aria-current"),
    ).toBe(false);
  });

  it("goes to the catalog when the brand is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SiteHeader />, { url: "/keranjang" });

    await user.click(screen.getByRole("link", { name: "GoShop" }));

    expect(currentLocation()).toBe("/");
  });
});
