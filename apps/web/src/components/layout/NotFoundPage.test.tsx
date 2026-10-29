import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotFoundPage } from "./NotFoundPage.tsx";

describe("NotFoundPage (app/not-found.tsx)", () => {
  it("says the address does not exist by default, with a link to the catalog", () => {
    render(<NotFoundPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Halaman tidak ditemukan" })
        .tabIndex,
    ).toBe(-1);
    expect(
      screen.getByText(
        "Alamat ini tidak ada di GoShop. Mungkin tautannya salah ketik.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Kembali ke katalog" })
        .getAttribute("href"),
    ).toBe("/");
  });

  it("says what is missing when told", () => {
    render(<NotFoundPage message="Produk ini tidak ada." />);

    expect(screen.getByText("Produk ini tidak ada.")).toBeTruthy();
    expect(screen.queryByText(/Alamat ini tidak ada/)).toBeNull();
  });
});
