import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  errorResponse,
  fetchMock,
  product,
  productResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import {
  currentLocation,
  renderApp,
  renderWithProviders,
} from "@/test/render.tsx";
import { setNavigationState } from "@/lib/navigation-state.ts";
import { FROM_CATALOG } from "../paths.ts";
import { ProductDetailPage } from "./ProductDetailPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const back = () => screen.getByRole("link", { name: "← Kembali ke katalog" });

const renderPage = (slug: string) =>
  renderWithProviders(<ProductDetailPage slug={slug} />, {
    path: "/produk/[slug]",
    url: `/produk/${encodeURIComponent(slug)}`,
  });

/** What a catalog card's click leaves for the product page. */
const openedFromCatalog = () => {
  setNavigationState("/produk/kaos", FROM_CATALOG);
};

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductDetailPage", () => {
  it("loads the product named by its slug", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderPage("kaos-polos");

    const input = fetchMock.mock.calls[0]?.[0];
    expect(input && requestUrl(input).pathname).toBe("/v1/products/kaos-polos");
  });

  it("links back to the catalog", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderPage("kaos");

    expect(back().getAttribute("href")).toBe("/");
    await user.click(back());

    expect(currentLocation()).toBe("/");
  });

  it("says Memuat produk… while loading, then shows the product", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    renderPage("kaos-polos");

    expect(screen.getByRole("status").textContent).toBe("Memuat produk…");
    answer.resolve(
      productResponse(product("kaos-polos", { name: "Kaos Polos" })),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Kaos Polos" }),
    ).toBeTruthy();
    expect(screen.queryByText("Memuat produk…")).toBeNull();
  });

  it("hands NOT_FOUND to notFound(): the product's 404 page, with no retry", async () => {
    // React logs every error a boundary catches; this one is expected.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(errorResponse(404, "NOT_FOUND", "req-404"));
    renderApp("/produk/nope");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Halaman tidak ditemukan",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Produk ini tidak ada atau sudah tidak dijual."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("shows any other error with Coba lagi, which loads it again", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR", "req-1"))
      .mockResolvedValueOnce(
        productResponse(product("kaos", { name: "Kaos" })),
      );
    renderPage("kaos");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Kode permintaan: req-1");
    expect(screen.queryByText("Produk tidak ditemukan.")).toBeNull();
    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Kaos" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("goes back in history to the list it came from, filters and all", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    openedFromCatalog();
    const { router } = renderWithProviders(<ProductDetailPage slug="kaos" />, {
      path: "/produk/[slug]",
      url: ["/?kategori=kaos&urut=termurah", "/produk/kaos"],
    });

    await user.click(back());

    expect(currentLocation()).toBe("/?kategori=kaos&urut=termurah");
    expect(router.lastAction).toBe("back");
  });

  it("follows its link to / when sessionStorage is blocked, without breaking the page", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    // Site data blocked: reading window.sessionStorage itself throws.
    const real = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      // The catalog card's click: the hint is lost, not the navigation.
      expect(openedFromCatalog).not.toThrow();
      const { router } = renderWithProviders(
        <ProductDetailPage slug="kaos" />,
        {
          path: "/produk/[slug]",
          url: ["/?kategori=kaos&urut=termurah", "/produk/kaos"],
        },
      );

      await user.click(back());

      expect(currentLocation()).toBe("/");
      expect(router.lastAction).toBe("push");
    } finally {
      if (real) Object.defineProperty(window, "sessionStorage", real);
    }
  });

  it("follows its link to / when the product was opened some other way", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { router } = renderWithProviders(<ProductDetailPage slug="kaos" />, {
      path: "/produk/[slug]",
      url: ["/?kategori=kaos", "/produk/kaos"],
    });

    await user.click(back());

    expect(currentLocation()).toBe("/");
    expect(router.lastAction).toBe("push");
  });

  it("leaves a modified click (new tab) to the browser", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    openedFromCatalog();
    renderWithProviders(<ProductDetailPage slug="kaos" />, {
      path: "/produk/[slug]",
      url: ["/?kategori=kaos", "/produk/kaos"],
    });

    await user.keyboard("{Control>}");
    await user.click(back());
    await user.keyboard("{/Control}");

    // Not taken as "back": the browser opens the link's href in a new tab,
    // so this page stays where it is.
    expect(currentLocation()).toBe("/produk/kaos");
  });
});
