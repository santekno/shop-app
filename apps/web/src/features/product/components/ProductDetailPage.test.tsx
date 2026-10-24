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
import { ProductDetailPage } from "./ProductDetailPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const back = () => screen.getByRole("link", { name: "← Kembali ke katalog" });

const renderPage = (slug: string) =>
  renderWithProviders(<ProductDetailPage />, {
    path: "/produk/:slug",
    url: `/produk/${encodeURIComponent(slug)}`,
  });

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductDetailPage", () => {
  it("loads the product named by the URL's slug", () => {
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

  it("hands NOT_FOUND to the route's error boundary: the 404 page, with no retry", async () => {
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
});
