import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMock } from "@/test/fake-api.ts";
import { renderApp } from "@/test/render.tsx";
import { routes } from "./routes.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const heading = (name: string) =>
  screen.findByRole("heading", { level: 1, name });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => undefined));
});

describe("routes", () => {
  it("put every page under one root route with the layout", () => {
    expect(routes).toHaveLength(1);
    expect(routes[0]?.path).toBe("/");
  });

  it.each([
    ["/masuk", "Masuk"],
    ["/daftar", "Daftar akun"],
  ])(
    "frame %s in the auth layout, inside the root layout",
    async (url, name) => {
      renderApp(url);

      const h1 = await heading(name);
      expect(h1.closest(".auth-layout")).not.toBeNull();
      expect(h1.closest("main")).not.toBeNull();
      expect(screen.getByRole("banner")).toBeTruthy();
    },
  );

  it.each([
    ["/", "Katalog"],
    ["/keranjang", "Keranjang"],
    ["/tidak-ada", "Halaman tidak ditemukan"],
  ])("leave %s outside the auth layout", async (url, name) => {
    renderApp(url);

    const h1 = await heading(name);
    expect(h1.closest(".auth-layout")).toBeNull();
    expect(h1.closest("main")).not.toBeNull();
  });

  it("send any unknown path, however deep, to the 404 page", async () => {
    renderApp("/produk/kaos/ulasan");

    expect(await heading("Halaman tidak ditemukan")).toBeTruthy();
    expect(
      screen.getByText(
        "Alamat ini tidak ada di GoShop. Mungkin tautannya salah ketik.",
      ),
    ).toBeTruthy();
  });
});
