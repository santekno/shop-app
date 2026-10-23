import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import {
  categoriesResponse,
  category,
  fetchMock,
  product,
  productResponse,
  productsResponse,
  requestUrl,
  serve,
} from "@/test/fake-api.ts";
import { App } from "./App.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const kaos = product("kaos-polos", { name: "Kaos Polos" });
const kemeja = product("kemeja", { name: "Kemeja Flanel" });

/** jsdom has no scrollTo; App calls it when a product opens. */
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock.mockReset();
  document.title = "GoShop";
  scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  serve((url) => {
    if (url.pathname === "/v1/categories") {
      return categoriesResponse([category("1", "Pakaian")]);
    }
    if (url.pathname === "/v1/products") {
      return productsResponse([kaos, kemeja], null);
    }
    if (url.pathname === "/v1/products/kaos-polos")
      return productResponse(kaos);
    return undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const productRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/products",
  ).length;

const catalog = () =>
  screen.getByRole("region", { name: "Produk", hidden: true });

const openKaos = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Kaos Polos" }));
  await screen.findByRole("heading", { level: 2, name: "Kaos Polos" });
};

describe("App", () => {
  it("shows the GoShop heading, as a button, and the catalog", async () => {
    render(<App />);

    const heading = screen.getByRole("heading", { level: 1, name: "GoShop" });
    expect(
      within(heading).getByRole("button", { name: "GoShop" }),
    ).toBeTruthy();
    const main = screen.getByRole("main");
    expect(
      main.contains(screen.getByRole("region", { name: "Kategori" })),
    ).toBe(true);
    expect(
      await screen.findByRole("button", { name: "Kaos Polos" }),
    ).toBeTruthy();
    expect(await screen.findByText("Pakaian")).toBeTruthy();
    expect(document.title).toBe("Katalog — GoShop");
  });

  it("opens a product: hides the catalog, keeps it mounted, scrolls to the top", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openKaos(user);

    expect(screen.queryByRole("region", { name: "Produk" })).toBeNull();
    expect(catalog().closest("[hidden]")).not.toBeNull();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0 });
    expect(document.title).toBe("Kaos Polos — GoShop");
    expect(
      screen.getByRole("button", { name: "← Kembali ke katalog" }),
    ).toBeTruthy();
  });

  it("goes back with Kembali to the same catalog, without loading it again", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openKaos(user);
    const loads = productRequests();

    await user.click(
      screen.getByRole("button", { name: "← Kembali ke katalog" }),
    );

    expect(screen.getByRole("region", { name: "Produk" })).toBe(catalog());
    expect(catalog().closest("[hidden]")).toBeNull();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Kaos Polos" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Kemeja Flanel" })).toBeTruthy();
    expect(productRequests()).toBe(loads);
    expect(document.title).toBe("Katalog — GoShop");
  });

  it("puts the focus back on the opened card's button after Kembali", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Kemeja Flanel" });
    await user.click(screen.getByRole("button", { name: "Kemeja Flanel" }));
    await screen.findByText("Produk tidak ditemukan.");

    await user.click(
      screen.getByRole("button", { name: "← Kembali ke katalog" }),
    );

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Kemeja Flanel" }),
    );
  });

  it("puts the focus back on the opened card's button after the GoShop brand", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openKaos(user);

    await user.click(screen.getByRole("button", { name: "GoShop" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Kaos Polos" }),
    );
  });

  it("moves no focus when the brand is clicked on the catalog", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Kaos Polos" });

    await user.click(screen.getByRole("button", { name: "GoShop" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "GoShop" }),
    );
  });

  it("moves no focus when the brand is clicked after a product was already left", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openKaos(user);
    await user.click(
      screen.getByRole("button", { name: "← Kembali ke katalog" }),
    );
    (document.activeElement as HTMLElement).blur();

    await user.click(screen.getByRole("button", { name: "GoShop" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "GoShop" }),
    );
  });

  it("moves no focus on mount, StrictMode's double mount included", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Kaos Polos" });

    expect(document.activeElement).toBe(document.body);
  });

  it("goes back to the catalog through the GoShop brand", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openKaos(user);

    await user.click(screen.getByRole("button", { name: "GoShop" }));

    expect(screen.getByRole("region", { name: "Produk" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "← Kembali ke katalog" }),
    ).toBeNull();
  });
});
