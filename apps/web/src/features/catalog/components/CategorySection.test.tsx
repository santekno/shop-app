import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  deferred,
  errorResponse,
  fetchMock,
} from "@/test/fake-api.ts";
import { inRouter } from "@/test/render.tsx";
import type { CatalogFilters } from "../catalog-filters.ts";
import { CategorySection } from "./CategorySection.tsx";

const ALL: CatalogFilters = {
  category: undefined,
  q: undefined,
  sort: "newest",
};

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
});

describe("CategorySection", () => {
  it("shows a loading status while the request runs", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));

    render(inRouter(<CategorySection filters={ALL} />));

    expect(
      screen.getByRole("heading", { level: 2, name: "Kategori" }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Memuat kategori…");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the categories as a tree once they arrive", async () => {
    fetchMock.mockResolvedValue(
      categoriesResponse([
        category("1", "Pakaian"),
        category("2", "Kaos", "1"),
      ]),
    );

    render(inRouter(<CategorySection filters={ALL} />));

    expect(await screen.findByText("Kaos")).toBeTruthy();
    expect(screen.getByText("Pakaian")).toBeTruthy();
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says so when there are no categories", async () => {
    fetchMock.mockResolvedValue(categoriesResponse([]));

    render(inRouter(<CategorySection filters={ALL} />));

    expect(await screen.findByText("Belum ada kategori.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the error message and the request ID in an alert", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR", "req-42"));

    render(inRouter(<CategorySection filters={ALL} />));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeTruthy();
    expect(alert.textContent).toContain("Kode permintaan: req-42");
    expect(within(alert).getByText("req-42").tagName).toBe("CODE");
    expect(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves the request ID out when there is none", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(inRouter(<CategorySection filters={ALL} />));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
      ),
    ).toBeTruthy();
    expect(alert.textContent).not.toContain("Kode permintaan");
    expect(alert.querySelector("code")).toBeNull();
  });

  it("loads again when Coba lagi is pressed", async () => {
    const user = userEvent.setup();
    const answer = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(errorResponse(503, "INTERNAL_ERROR"))
      .mockImplementationOnce(() => answer.promise);

    render(inRouter(<CategorySection filters={ALL} />));
    await user.click(await screen.findByRole("button", { name: "Coba lagi" }));

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    answer.resolve(categoriesResponse([category("1", "Pakaian")]));
    expect(await screen.findByText("Pakaian")).toBeTruthy();
  });

  it("links each category to the catalog, keeping the search and the sort", async () => {
    fetchMock.mockResolvedValue(
      categoriesResponse([
        category("1", "Pakaian"),
        category("2", "Kaos", "1"),
      ]),
    );
    const filters: CatalogFilters = {
      category: "kaos",
      q: "polos",
      sort: "price_asc",
    };

    render(inRouter(<CategorySection filters={filters} />));

    const kaos = await screen.findByRole("link", { name: "Kaos" });
    expect(kaos.getAttribute("href")).toBe(
      "/?kategori=kaos&q=polos&urut=termurah",
    );
    expect(kaos.getAttribute("aria-current")).toBe("true");
    const all = screen.getByRole("link", { name: "Semua produk" });
    expect(all.getAttribute("href")).toBe("/?q=polos&urut=termurah");
    expect(all.hasAttribute("aria-current")).toBe(false);
  });

  it("marks Semua produk as current when no category is chosen", async () => {
    fetchMock.mockResolvedValue(categoriesResponse([category("1", "Pakaian")]));

    render(inRouter(<CategorySection filters={ALL} />));

    const all = await screen.findByRole("link", { name: "Semua produk" });
    expect(all.getAttribute("href")).toBe("/");
    expect(all.getAttribute("aria-current")).toBe("true");
  });

  it("folds the list behind a toggle on a phone that says whether it is open", async () => {
    const events = userEvent.setup();
    fetchMock.mockResolvedValue(categoriesResponse([category("1", "Kaos")]));
    render(inRouter(<CategorySection filters={ALL} />));

    const toggle = await screen.findByRole("button", {
      name: "Tampilkan kategori",
    });
    const listId = toggle.getAttribute("aria-controls") ?? "";
    const list = document.getElementById(listId);
    expect(list?.contains(screen.getByText("Kaos"))).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Folded on a phone, always shown from md up.
    expect(list?.className).toBe("hidden md:block");

    await events.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Sembunyikan kategori");
    expect(list?.className).toBe("block");

    await events.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Tampilkan kategori");
    expect(list?.className).toBe("hidden md:block");
  });
});
