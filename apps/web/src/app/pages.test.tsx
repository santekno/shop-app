// The storefront's pages as the app/ folder nests them (src/test/
// app-tree.tsx): each URL reaches its page, inside the layouts and the
// header, and the focus follows a navigation.
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  fetchMock,
  product,
  productResponse,
  productsResponse,
  serve,
} from "@/test/fake-api.ts";
import { renderApp } from "@/test/render.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const kaos = product("kaos-polos", { name: "Kaos Polos" });

beforeEach(() => {
  fetchMock.mockReset();
  serve((url) => {
    if (url.pathname === "/v1/categories") {
      return categoriesResponse([category("1", "Pakaian")]);
    }
    if (url.pathname === "/v1/products") return productsResponse([kaos], null);
    if (url.pathname === "/v1/products/kaos-polos")
      return productResponse(kaos);
    return undefined;
  });
});

const pageHeading = (name: string) =>
  screen.findByRole("heading", { level: 1, name });

describe("the storefront's pages", () => {
  it.each([
    ["/", "Katalog"],
    ["/produk/kaos-polos", "Kaos Polos"],
    ["/keranjang", "Keranjang"],
    ["/masuk", "Masuk"],
    ["/daftar", "Daftar akun"],
    ["/tidak/ada", "Halaman tidak ditemukan"],
  ])("shows %s with its heading, inside the layout", async (url, heading) => {
    renderApp(url);

    const h1 = await pageHeading(heading);
    expect(screen.getByRole("main").contains(h1)).toBe(true);
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it.each([
    ["/masuk", "Masuk"],
    ["/daftar", "Daftar akun"],
  ])(
    "frame %s in the auth layout, inside the root layout",
    async (url, name) => {
      renderApp(url);

      const h1 = await pageHeading(name);
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

    const h1 = await pageHeading(name);
    expect(h1.closest(".auth-layout")).toBeNull();
    expect(h1.closest("main")).not.toBeNull();
  });

  it("send any unknown path, however deep, to the 404 page", async () => {
    renderApp("/produk/kaos/ulasan");

    expect(await pageHeading("Halaman tidak ditemukan")).toBeTruthy();
    expect(
      screen.getByText(
        "Alamat ini tidak ada di GoShop. Mungkin tautannya salah ketik.",
      ),
    ).toBeTruthy();
  });
});

describe("the focus across pages", () => {
  it("is left alone on the first render", async () => {
    renderApp("/");

    await pageHeading("Katalog");
    expect(document.activeElement).toBe(document.body);
  });

  it("moves to the new page's heading after a navigation", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await pageHeading("Katalog");

    await user.click(
      within(screen.getByRole("navigation", { name: "Utama" })).getByRole(
        "link",
        { name: "Keranjang" },
      ),
    );

    expect(document.activeElement).toBe(await pageHeading("Keranjang"));
  });

  it("moves to <main> when the new page has no heading yet", async () => {
    const user = userEvent.setup();
    serve((url) => {
      if (url.pathname === "/v1/products/kaos-polos") {
        return new Promise<Response>(() => undefined);
      }
      if (url.pathname === "/v1/products")
        return productsResponse([kaos], null);
      return categoriesResponse([]);
    });
    renderApp("/");

    await user.click(await screen.findByRole("link", { name: "Kaos Polos" }));

    expect(await screen.findByText("Memuat produk…")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("stays where it is when only the query string changes", async () => {
    const { router } = renderApp("/");
    const heading = await pageHeading("Katalog");
    const brand = screen.getByRole("link", { name: "GoShop" });
    brand.focus();

    act(() => {
      router.push("/?urut=termurah");
    });

    expect(document.activeElement).toBe(brand);
    expect(heading.isConnected).toBe(true);
  });
});

describe("from a product back to the catalog", () => {
  it("goes back with Kembali", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Kaos Polos" }));
    await pageHeading("Kaos Polos");

    await user.click(
      screen.getByRole("link", { name: "← Kembali ke katalog" }),
    );

    expect(await pageHeading("Katalog")).toBeTruthy();
  });
});
