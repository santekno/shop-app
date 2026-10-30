import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminProductTable } from "@goshop/shared";
import { category, productRow, productTable } from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import type { Answer } from "@/test/msw/answers.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  categoriesHandler,
  productTableHandler,
  productTableResponse,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { MAIN_ID } from "@/app/useRouteFocus.ts";
import { productKeys } from "../api/queries.ts";
import { ProductsPage } from "./ProductsPage.tsx";

const renderPage = (
  url = "/produk",
  answer: Answer | AdminProductTable = productTable([productRow(1)]),
) => {
  server.use(
    categoriesHandler([category("c-kaos", "Kaos")]),
    productTableHandler(answer),
  );
  // In <main>, as DashboardLayout renders it: "Coba lagi" focuses the
  // page's heading through it.
  return renderRoute(
    <main id={MAIN_ID} tabIndex={-1}>
      <ProductsPage />
    </main>,
    { path: "/produk", url },
  );
};

const pageHeading = () =>
  screen.getByRole("heading", { level: 1, name: "Produk" });

const tableRequests = (sent: ReturnType<typeof recordRequests>) =>
  sent.filter((r) => r.url.pathname === "/v1/admin/products");

describe("ProductsPage", () => {
  it("shows a skeleton while the first page loads, then the table", async () => {
    const answer = deferred<Response>();
    renderPage("/produk", () => answer.promise);

    expect(screen.getByRole("status")).toHaveTextContent("Memuat produk…");
    expect(screen.queryByRole("table")).toBeNull();
    answer.resolve(productTableResponse(productTable([productRow(1)])));

    expect(
      await screen.findByRole("link", { name: productRow(1).name }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Produk — GoShop Admin");
  });

  it("links to the create form", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Tambah produk" })).toHaveAttribute(
      "href",
      "/produk/baru",
    );
  });

  it("asks the API for exactly what the URL says, as the logged-in user", async () => {
    const sent = recordRequests();
    renderPage("/produk?q=kaos&status=aktif&urut=nama&arah=naik&halaman=2");

    await screen.findByRole("table");
    const [request] = tableRequests(sent);
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      q: "kaos",
      status: "active",
      sort: "name",
      order: "asc",
      page: "2",
      per_page: "20",
    });
    expect(request?.headers.get("Authorization")).toBe("Bearer token-1");
  });

  it("gives the filters the API's low-stock threshold", async () => {
    renderPage("/produk", productTable([productRow(1)], { threshold: 9 }));

    expect(
      await screen.findByRole("checkbox", { name: "Stok menipis (≤ 9)" }),
    ).toBeInTheDocument();
  });

  it("writes a filter to the URL and loads that page", async () => {
    const sent = recordRequests();
    const user = userEvent.setup();
    const { router } = renderPage("/produk?halaman=3");
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Status"), "Draf");

    expect(router.state.location.search).toBe("?status=draf");
    await waitFor(() => {
      expect(tableRequests(sent).at(-1)?.url.searchParams.get("status")).toBe(
        "draft",
      );
    });
    expect(tableRequests(sent).at(-1)?.url.searchParams.get("page")).toBe("1");
  });

  it("writes a sort to the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByRole("table");

    await user.click(
      within(
        screen.getByRole("columnheader", { name: /^Harga mulai/ }),
      ).getByRole("button"),
    );

    expect(router.state.location.search).toBe("?urut=harga");
  });

  it("says why the table failed and loads it again from Coba lagi", async () => {
    let calls = 0;
    const user = userEvent.setup();
    renderPage("/produk", () => {
      calls += 1;
      return calls === 1
        ? errorResponse(500, "INTERNAL_ERROR")
        : productTableResponse(productTable([productRow(1)]));
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Terjadi kesalahan saat memuat data.");
    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    expect(
      await screen.findByRole("link", { name: productRow(1).name }),
    ).toBeInTheDocument();
  });

  it("gives the page heading the focus when Coba lagi turns the error into loading, and keeps it there", async () => {
    let calls = 0;
    const second = deferred<Response>();
    const user = userEvent.setup();
    renderPage("/produk", () => {
      calls += 1;
      return calls === 1
        ? errorResponse(500, "INTERNAL_ERROR")
        : second.promise;
    });
    const retry = within(await screen.findByRole("alert")).getByRole("button", {
      name: "Coba lagi",
    });
    retry.focus();

    await user.keyboard("{Enter}");

    expect(await screen.findByText("Memuat produk…")).toBeInTheDocument();
    expect(retry).not.toBeInTheDocument();
    expect(pageHeading()).toHaveFocus();

    second.resolve(productTableResponse(productTable([productRow(1)])));

    expect(
      await screen.findByRole("link", { name: productRow(1).name }),
    ).toBeInTheDocument();
    expect(pageHeading()).toHaveFocus();
  });

  describe("when a refetch fails with rows on screen", () => {
    const STALE = "Daftar produk tidak bisa diperbarui";
    const staleLine = () =>
      screen
        .queryAllByRole("status")
        .find((status) => status.textContent.includes(STALE));
    const theStaleLine = () => {
      const line = staleLine();
      if (line === undefined) throw new Error("no stale line");
      return line;
    };

    /** The page loaded, then a refetch in the background (a stock change). */
    const loadedThenFailed = async (
      answers: (() => Response | Promise<Response>)[],
    ) => {
      let calls = 0;
      const view = renderPage("/produk", () => {
        const answer = answers[calls] ?? answers[answers.length - 1];
        calls += 1;
        if (answer === undefined) throw new Error("no answer");
        return answer();
      });
      await screen.findByRole("link", { name: productRow(1).name });
      await act(() =>
        view.queryClient.refetchQueries({ queryKey: productKeys.tables }),
      );
      await waitFor(() => {
        expect(calls).toBe(2);
        expect(staleLine()).toBeDefined();
      });
      return { ...view, calls: () => calls };
    };

    it("keeps the rows, with a line saying they may be behind instead of the error card", async () => {
      await loadedThenFailed([
        () => productTableResponse(productTable([productRow(1)])),
        () => errorResponse(500, "INTERNAL_ERROR"),
      ]);

      expect(screen.queryByRole("alert")).toBeNull();
      expect(
        screen.getByRole("link", { name: productRow(1).name }),
      ).toBeInTheDocument();
      expect(staleLine()?.textContent).toBe(
        "Daftar produk tidak bisa diperbarui; yang tampil adalah daftar terakhir yang berhasil dimuat. Terjadi kesalahan saat memuat data. Coba lagi.Coba lagi",
      );
    });

    it("loads again from the line's Coba lagi, and drops the line once it works", async () => {
      const user = userEvent.setup();
      const { calls } = await loadedThenFailed([
        () => productTableResponse(productTable([productRow(1)])),
        () => errorResponse(500, "INTERNAL_ERROR"),
        () => productTableResponse(productTable([productRow(2)])),
      ]);

      await user.click(
        within(theStaleLine()).getByRole("button", {
          name: "Coba lagi",
        }),
      );

      expect(
        await screen.findByRole("link", { name: productRow(2).name }),
      ).toBeInTheDocument();
      expect(staleLine()).toBeUndefined();
      expect(calls()).toBe(3);
    });

    it("gives the page heading the focus from the line's Coba lagi, which goes once the rows arrive", async () => {
      const third = deferred<Response>();
      const user = userEvent.setup();
      await loadedThenFailed([
        () => productTableResponse(productTable([productRow(1)])),
        () => errorResponse(500, "INTERNAL_ERROR"),
        () => third.promise,
      ]);
      const retry = within(theStaleLine()).getByRole("button", {
        name: "Coba lagi",
      });
      retry.focus();

      await user.keyboard("{Enter}");

      // Still on its way: the line (and the button) are still there.
      expect(retry).toBeInTheDocument();
      expect(pageHeading()).toHaveFocus();

      third.resolve(productTableResponse(productTable([productRow(2)])));

      expect(
        await screen.findByRole("link", { name: productRow(2).name }),
      ).toBeInTheDocument();
      expect(staleLine()).toBeUndefined();
      expect(pageHeading()).toHaveFocus();
    });

    it("shows the error card for a filter that fails, with no rows for it", async () => {
      let calls = 0;
      const user = userEvent.setup();
      renderPage("/produk", () => {
        calls += 1;
        return calls === 1
          ? productTableResponse(productTable([productRow(1)]))
          : errorResponse(500, "INTERNAL_ERROR");
      });
      await screen.findByRole("link", { name: productRow(1).name });

      await user.selectOptions(screen.getByLabelText("Status"), "Draf");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Terjadi kesalahan saat memuat data. Coba lagi.",
      );
      expect(staleLine()).toBeUndefined();
      expect(
        screen.queryByRole("link", { name: productRow(1).name }),
      ).toBeNull();
    });
  });

  it("says there are no products yet, without Hapus filter", async () => {
    renderPage("/produk", productTable([], { total: 0 }));

    expect(
      await screen.findByText(
        "Belum ada produk. Produk yang ditambahkan akan muncul di sini.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hapus filter" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says nothing matches the filters, and clears them from Hapus filter", async () => {
    const user = userEvent.setup();
    const { router } = renderPage(
      "/produk?status=draf&urut=nama",
      productTable([], { total: 0 }),
    );

    const empty = await screen.findByText(
      "Tidak ada produk yang cocok dengan pencarian atau filter ini.",
    );
    // Two "Hapus filter": the filter bar's and the empty state's.
    const box = empty.parentElement;
    if (box === null) throw new Error("no empty state");
    const button = within(box).getByRole("button", { name: "Hapus filter" });
    await user.click(button);

    expect(router.state.location.search).toBe("?urut=nama");
  });

  it("offers the last page for a page past the end", async () => {
    const user = userEvent.setup();
    const { router } = renderPage(
      "/produk?halaman=9",
      productTable([], { page: 9, total: 45 }),
    );

    expect(
      await screen.findByText("Halaman 9 tidak ada: hasilnya hanya 3 halaman."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ke halaman 3" }));

    expect(router.state.location.search).toBe("?halaman=3");
  });

  it("keeps the last page on screen, busy, while the next one loads", async () => {
    const next = deferred<Response>();
    const user = userEvent.setup();
    renderPage("/produk", (request) =>
      new URL(request.url).searchParams.get("page") === "1"
        ? productTableResponse(productTable([productRow(1)], { total: 45 }))
        : next.promise,
    );
    await screen.findByRole("table");

    await user.click(
      screen.getByRole("button", { name: "Halaman berikutnya" }),
    );

    expect(
      screen.getByRole("region", { name: /^Daftar produk/ }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("link", { name: productRow(1).name }),
    ).toBeInTheDocument();
    next.resolve(
      productTableResponse(
        productTable([productRow(21)], { page: 2, total: 45 }),
      ),
    );
    expect(
      await screen.findByRole("link", { name: productRow(21).name }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /^Daftar produk/ }),
    ).toHaveAttribute("aria-busy", "false");
  });
});
