import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  fetchMock,
  product,
  productResponse,
  productsResponse,
  cartLine,
  cartOf,
  cartResponse,
  noContentResponse,
  serve,
  user,
  webSessionResponse,
} from "@/test/fake-api.ts";
import { renderApp } from "@/test/render.tsx";
import { useCartStore } from "@/features/cart/cart-store.ts";
import { queryClient } from "@/lib/query-client.ts";
import { App } from "./App.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
// Under Node, react-router/dom loads react-router's ESM build while the
// app's own imports get its CommonJS build: two router contexts, and the
// routes cannot see the router. The browser bundle has one copy, so here
// App gets the RouterProvider of the copy the routes use.
vi.mock("react-router/dom", async () => {
  const { RouterProvider } = await import("react-router");
  return { RouterProvider };
});

const kaos = product("kaos-polos", { name: "Kaos Polos" });

beforeEach(() => {
  fetchMock.mockReset();
  document.title = "GoShop";
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

describe("App", () => {
  it("renders the storefront at the browser's address", async () => {
    render(<App />);

    expect(await pageHeading("Katalog")).toBeTruthy();
    expect(screen.getByRole("link", { name: "GoShop" })).toBeTruthy();
  });
});

describe("the storefront's routes", () => {
  it.each([
    ["/", "Katalog", "Katalog — GoShop"],
    ["/produk/kaos-polos", "Kaos Polos", "Kaos Polos — GoShop"],
    ["/keranjang", "Keranjang", "Keranjang — GoShop"],
    ["/masuk", "Masuk", "Masuk — GoShop"],
    ["/daftar", "Daftar akun", "Daftar — GoShop"],
    [
      "/tidak/ada",
      "Halaman tidak ditemukan",
      "Halaman tidak ditemukan — GoShop",
    ],
  ])(
    "shows %s with its heading and title, inside the layout",
    async (url, heading, title) => {
      renderApp(url);

      const h1 = await pageHeading(heading);
      expect(screen.getByRole("main").contains(h1)).toBe(true);
      expect(screen.getByRole("banner")).toBeTruthy();
      expect(document.title).toBe(title);
    },
  );

  it("leaves the focus alone on the first render", async () => {
    renderApp("/");

    await pageHeading("Katalog");
    expect(document.activeElement).toBe(document.body);
  });

  it("focuses the new page's heading after a navigation", async () => {
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

  it("focuses <main> when the new page has no heading yet", async () => {
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

  it("keeps the focus where it is when only the query string changes", async () => {
    const { router } = renderApp("/");
    const heading = await pageHeading("Katalog");
    const brand = screen.getByRole("link", { name: "GoShop" });
    brand.focus();

    await act(() => router.navigate("/?urut=termurah"));

    expect(document.activeElement).toBe(brand);
    expect(heading.isConnected).toBe(true);
  });

  it("goes back to the catalog from a product with Kembali", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Kaos Polos" }));
    await pageHeading("Kaos Polos");

    await user.click(
      screen.getByRole("link", { name: "← Kembali ke katalog" }),
    );

    expect(await pageHeading("Katalog")).toBeTruthy();
    expect(document.title).toBe("Katalog — GoShop");
  });
});

describe("App: what a session's start and end do to the cart", () => {
  it("merges the guest cart at the restore, and drops the user's data at logout", async () => {
    const events = userEvent.setup();
    const merged = cartOf([cartLine("m", { quantity: 4 })]);
    useCartStore.getState().setToken("guest-tok");
    queryClient.clear();
    const calls: string[] = [];
    serve((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/v1/auth/web/refresh") {
        return webSessionResponse(user({ id: "u1", name: "Budi" }), "a");
      }
      if (url.pathname === "/v1/cart/merge") return cartResponse(merged);
      if (url.pathname === "/v1/cart") return cartResponse(merged);
      if (url.pathname === "/v1/auth/web/logout") return noContentResponse();
      if (url.pathname === "/v1/categories") return categoriesResponse([]);
      if (url.pathname === "/v1/products") return productsResponse([], null);
      return undefined;
    });
    render(<App />);

    // Merged before the header shows the user, with the merged count.
    expect(
      await screen.findByRole("button", { name: /^Halo, Budi/ }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("link", { name: "Keranjang 4 barang" }),
    ).toBeTruthy();
    expect(calls.indexOf("POST /v1/cart/merge")).toBeGreaterThan(
      calls.indexOf("POST /v1/auth/web/refresh"),
    );
    expect(useCartStore.getState().token).toBeNull();
    expect(queryClient.getQueryData(["cart", "user", "u1"])).toEqual(merged);
    queryClient.setQueryData(["me", "u1"], user({ id: "u1" }));

    await events.click(screen.getByRole("button", { name: /^Halo, Budi/ }));
    await events.click(await screen.findByRole("menuitem", { name: "Keluar" }));

    expect(await screen.findByRole("link", { name: "Masuk" })).toBeTruthy();
    expect(queryClient.getQueryData(["cart", "user", "u1"])).toBeUndefined();
    expect(queryClient.getQueryData(["me", "u1"])).toBeUndefined();
    queryClient.clear();
  });
});
