import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { orderSummary } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { orderListResponse, orderQueueHandler } from "@/test/msw/orders.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { formatDateTime } from "@/lib/format-date.ts";
import { invalidateOrderQueries } from "../api/queries.ts";
import { OrdersPage } from "./OrdersPage.tsx";

const renderPage = (url = "/pesanan") =>
  renderRoute(<OrdersPage />, { path: "/pesanan", url });

/** Answers each cursor with its own page: "" is the first. */
const pages = (byCursor: Record<string, () => Response | Promise<Response>>) =>
  orderQueueHandler((request) => {
    const cursor = new URL(request.url).searchParams.get("cursor") ?? "";
    const answer = byCursor[cursor];
    if (answer === undefined) throw new Error(`no page for cursor ${cursor}`);
    return answer();
  });

const table = () => screen.getByRole("region", { name: /^Pesanan / });

describe("OrdersPage", () => {
  it("opens the paid queue by default, as /pesanan", async () => {
    const sent = recordRequests();
    server.use(pages({ "": () => orderListResponse([orderSummary(1)]) }));
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Memuat pesanan…");
    expect(
      await screen.findByRole("link", { name: orderSummary(1).code }),
    ).toHaveAttribute("href", `/pesanan/${orderSummary(1).id}`);
    expect(sent[0]?.url.searchParams.get("status")).toBe("paid");
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
    expect(document.title).toBe("Pesanan dibayar — GoShop Admin");
    expect(
      within(
        screen.getByRole("navigation", { name: "Status pesanan" }),
      ).getByRole("link", {
        name: "Dibayar",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/siap dikemas/)).toBeInTheDocument();
  });

  it("reads the queue's status from the URL", async () => {
    const sent = recordRequests();
    server.use(
      pages({
        "": () =>
          orderListResponse([orderSummary(1, { status: "processing" })]),
      }),
    );
    renderPage("/pesanan?status=diproses");

    expect(
      await screen.findByRole("region", { name: "Pesanan diproses" }),
    ).toBeInTheDocument();
    expect(sent[0]?.url.searchParams.get("status")).toBe("processing");
    expect(
      screen.getByRole("columnheader", { name: "Terakhir berubah" }),
    ).toBeInTheDocument();
  });

  it("shows the payment deadline, not the last change, for unpaid orders", async () => {
    const row = orderSummary(1, {
      status: "pending_payment",
      payment_expires_at: "2026-10-31T03:00:00Z",
      updated_at: "2026-10-30T04:00:00Z",
    });
    server.use(pages({ "": () => orderListResponse([row]) }));
    renderPage("/pesanan?status=menunggu-bayar");

    await screen.findByRole("link", { name: row.code });
    expect(
      screen.getByRole("columnheader", { name: "Batas bayar" }),
    ).toBeInTheDocument();
    const [, firstRow] = screen.getAllByRole("row");
    if (firstRow === undefined) throw new Error("no order row");
    const cells = within(firstRow).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent(formatDateTime(row.payment_expires_at));
  });

  it("switches the queue with a tab, which is a link", async () => {
    server.use(pages({ "": () => orderListResponse([]) }));
    const userEvents = userEvent.setup();
    const { router } = renderPage();
    await screen.findByText("Tidak ada pesanan dengan status “Dibayar”.");

    await userEvents.click(screen.getByRole("link", { name: "Dikirim" }));

    expect(router.state.location.search).toBe("?status=dikirim");
    expect(
      await screen.findByText("Tidak ada pesanan dengan status “Dikirim”."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dikirim" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dibayar" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("says why the queue failed and loads it again from Coba lagi", async () => {
    let calls = 0;
    server.use(
      pages({
        "": () => {
          calls += 1;
          return calls === 1
            ? errorResponse(500, "INTERNAL_ERROR", { requestId: "req-5" })
            : orderListResponse([orderSummary(1)]);
        },
      }),
    );
    const userEvents = userEvent.setup();
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
    expect(alert).toHaveTextContent("req-5");
    await userEvents.click(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    );

    expect(
      await screen.findByRole("link", { name: orderSummary(1).code }),
    ).toBeInTheDocument();
  });

  describe("loading more", () => {
    it("waits while an event refetches the queue: 'Memuat…', no next page, the focus kept", async () => {
      const refetch = deferred<Response>();
      let firstPages = 0;
      const sent = recordRequests();
      server.use(
        pages({
          "": () => {
            firstPages += 1;
            return firstPages === 1
              ? orderListResponse([orderSummary(1)], "c2")
              : refetch.promise;
          },
          c2: () => orderListResponse([orderSummary(2)], null),
        }),
      );
      const userEvents = userEvent.setup();
      const { queryClient } = renderPage();
      const button = await screen.findByRole("button", {
        name: "Muat lebih banyak",
      });
      act(() => {
        button.focus();
      });

      act(() => {
        void invalidateOrderQueries(queryClient);
      });
      const waiting = await screen.findByRole("button", { name: "Memuat…" });
      expect(waiting).toHaveAttribute("aria-disabled", "true");
      expect(waiting).toHaveFocus();
      await userEvents.click(waiting);

      refetch.resolve(orderListResponse([orderSummary(1)], "c2"));
      const again = await screen.findByRole("button", {
        name: "Muat lebih banyak",
      });
      expect(again).toHaveFocus();
      expect(
        sent.filter((r) => r.url.searchParams.get("cursor") === "c2"),
      ).toEqual([]);
      expect(screen.getAllByRole("link", { name: /^GS-/ })).toHaveLength(1);
    });

    it("says how many are shown and that more follow", async () => {
      server.use(
        pages({ "": () => orderListResponse([orderSummary(1)], "c2") }),
      );
      renderPage();

      await screen.findByRole("link", { name: orderSummary(1).code });
      expect(
        screen.getByText("Menampilkan 1 pesanan. Masih ada pesanan lain."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Muat lebih banyak" }),
      ).toBeInTheDocument();
    });

    it("loads the next page once, keeps the button focusable while loading, then moves the focus to the first new order", async () => {
      const second = deferred<Response>();
      const sent = recordRequests();
      server.use(
        pages({
          "": () => orderListResponse([orderSummary(1)], "c2"),
          c2: () => second.promise,
        }),
      );
      const userEvents = userEvent.setup();
      renderPage();
      const button = await screen.findByRole("button", {
        name: "Muat lebih banyak",
      });

      await userEvents.click(button);
      const loading = await screen.findByRole("button", { name: "Memuat…" });
      expect(loading).toHaveAttribute("aria-disabled", "true");
      expect(loading).toBeEnabled();
      expect(loading).toHaveFocus();
      await userEvents.click(loading);
      second.resolve(
        orderListResponse([orderSummary(2), orderSummary(3)], null),
      );

      const firstNew = await screen.findByRole("link", {
        name: orderSummary(2).code,
      });
      await waitFor(() => {
        expect(firstNew).toHaveFocus();
      });
      expect(screen.queryByRole("button", { name: /Muat/ })).toBeNull();
      expect(
        screen.getByText("Menampilkan semua 3 pesanan."),
      ).toBeInTheDocument();
      expect(
        sent.filter((r) => r.url.searchParams.get("cursor") === "c2"),
      ).toHaveLength(1);
    });

    it("keeps the focus on the button when another page follows", async () => {
      server.use(
        pages({
          "": () => orderListResponse([orderSummary(1)], "c2"),
          c2: () => orderListResponse([orderSummary(2)], "c3"),
        }),
      );
      const userEvents = userEvent.setup();
      renderPage();

      await userEvents.click(
        await screen.findByRole("button", { name: "Muat lebih banyak" }),
      );

      await screen.findByRole("link", { name: orderSummary(2).code });
      const button = await screen.findByRole("button", {
        name: "Muat lebih banyak",
      });
      expect(button).toHaveFocus();
      expect(
        screen.getByText("Menampilkan 2 pesanan. Masih ada pesanan lain."),
      ).toBeInTheDocument();
    });

    it("moves the focus to the table when the last page was empty", async () => {
      server.use(
        pages({
          "": () => orderListResponse([orderSummary(1)], "c2"),
          c2: () => orderListResponse([], null),
        }),
      );
      const userEvents = userEvent.setup();
      renderPage();

      await userEvents.click(
        await screen.findByRole("button", { name: "Muat lebih banyak" }),
      );

      await waitFor(() => {
        expect(table()).toHaveFocus();
      });
      expect(
        screen.getByText("Menampilkan semua 1 pesanan."),
      ).toBeInTheDocument();
    });

    it("says the next page failed and offers to try again, keeping the focus", async () => {
      let calls = 0;
      server.use(
        pages({
          "": () => orderListResponse([orderSummary(1)], "c2"),
          c2: () => {
            calls += 1;
            return calls === 1
              ? errorResponse(500, "INTERNAL_ERROR")
              : orderListResponse([orderSummary(2)], null);
          },
        }),
      );
      const userEvents = userEvent.setup();
      renderPage();

      await userEvents.click(
        await screen.findByRole("button", { name: "Muat lebih banyak" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Pesanan berikutnya belum dapat dimuat.",
      );
      const retry = screen.getByRole("button", { name: "Coba muat lagi" });
      expect(retry).toHaveFocus();
      await userEvents.click(retry);
      expect(
        await screen.findByRole("link", { name: orderSummary(2).code }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows the table, not the empty text, for an empty first page with a cursor", async () => {
      server.use(
        pages({
          "": () => orderListResponse([], "c2"),
          c2: () => orderListResponse([orderSummary(9)], null),
        }),
      );
      renderPage();

      expect(
        await screen.findByRole("button", { name: "Muat lebih banyak" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Tidak ada pesanan/)).toBeNull();
      expect(
        screen.getByText("Menampilkan 0 pesanan. Masih ada pesanan lain."),
      ).toBeInTheDocument();
    });
  });
});
