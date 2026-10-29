// Providers as the root layout renders it: the browser's one QueryClient,
// the session, and what a session's start and end do to the cart.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/features/cart/cart-store.ts";
import { getQueryClient } from "@/lib/query-client.ts";
import { AppPages } from "@/test/app-tree.tsx";
import {
  cartLine,
  cartOf,
  cartResponse,
  categoriesResponse,
  noContentResponse,
  productsResponse,
  serve,
  user,
  webSessionResponse,
} from "@/test/fake-api.ts";
import { Providers } from "./Providers.tsx";
import { SiteFrame } from "./SiteFrame.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

afterEach(() => {
  // The browser's client outlives a test: empty it for the next one.
  getQueryClient().clear();
});

/** The storefront the way app/layout.tsx renders it, at the router's URL. */
const renderStorefront = () =>
  render(
    <Providers>
      <SiteFrame>
        <AppPages />
      </SiteFrame>
    </Providers>,
  );

describe("Providers", () => {
  it("renders the page with the header, restoring the session first", async () => {
    serve((url) => {
      if (url.pathname === "/v1/auth/web/refresh") {
        return Response.json(
          { error: { code: "UNAUTHORIZED", message: "x" } },
          { status: 401 },
        );
      }
      if (url.pathname === "/v1/categories") return categoriesResponse([]);
      if (url.pathname === "/v1/products") return productsResponse([], null);
      return undefined;
    });
    renderStorefront();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Katalog" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "GoShop" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Masuk" })).toBeTruthy();
  });

  it("merges the guest cart at the restore, and drops the user's data at logout", async () => {
    const events = userEvent.setup();
    const queryClient = getQueryClient();
    const merged = cartOf([cartLine("m", { quantity: 4 })]);
    useCartStore.getState().setToken("guest-tok");
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
    renderStorefront();

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
    queryClient.setQueryData(["checkout", "u1", "addresses"], []);
    queryClient.setQueryData(["orders", "u1", "list"], []);

    await events.click(screen.getByRole("button", { name: /^Halo, Budi/ }));
    await events.click(await screen.findByRole("menuitem", { name: "Keluar" }));

    expect(await screen.findByRole("link", { name: "Masuk" })).toBeTruthy();
    expect(queryClient.getQueryData(["cart", "user", "u1"])).toBeUndefined();
    expect(queryClient.getQueryData(["me", "u1"])).toBeUndefined();
    expect(
      queryClient.getQueryData(["checkout", "u1", "addresses"]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(["orders", "u1", "list"])).toBeUndefined();
  });
});
