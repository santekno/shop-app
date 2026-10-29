import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orderSummary, ordersResponse } from "@/test/checkout-fixtures.ts";
import {
  deferred,
  errorResponse,
  fetchMock,
  requestUrl,
  rupiah,
  user,
} from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import { formatDateTime } from "../format.ts";
import { OrdersPage } from "./OrdersPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };

/** The cursor of every GET /v1/orders so far ("" for the first page). */
const cursors = () =>
  fetchMock.mock.calls
    .map(([input]) => requestUrl(input))
    .filter((url) => url.pathname === "/v1/orders")
    .map((url) => url.searchParams.get("cursor") ?? "");

/** Answers GET /v1/orders by cursor: `pages[cursor]`, "" the first. */
const serveOrders = (
  pages: Record<string, () => Response | Promise<Response>>,
) => {
  fetchMock.mockImplementation((input) => {
    const url = requestUrl(input);
    const page = pages[url.searchParams.get("cursor") ?? ""];
    return Promise.resolve(
      url.pathname === "/v1/orders" && page !== undefined
        ? page()
        : errorResponse(404, "NOT_FOUND"),
    );
  });
};

const mount = () =>
  renderWithProviders(<OrdersPage />, { url: "/pesanan", session });

/** Two pages; the second fails once, then answers. */
const serveFlakySecondPage = () => {
  let failures = 1;
  serveOrders({
    "": () => ordersResponse([orderSummary("a")], "c2"),
    c2: () =>
      failures-- > 0
        ? errorResponse(503, "UPSTREAM_UNAVAILABLE")
        : ordersResponse([orderSummary("b")], null),
  });
};

const rows = () =>
  within(screen.getByRole("list", { name: "Daftar pesanan" })).getAllByRole(
    "listitem",
  );

/** The `index`th element of `list`; fails the test when there is none. */
const nth = <T,>(list: T[], index: number): T => {
  const item = list.at(index);
  if (item === undefined) throw new Error(`no element at ${String(index)}`);
  return item;
};

const loadMore = () =>
  screen.getByRole("button", { name: "Muat lebih banyak" });

const moreButton = () =>
  screen.queryByRole<HTMLButtonElement>("button", {
    name: /Muat lebih banyak|Memuat…/,
  });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("OrdersPage", () => {
  it("lists the buyer's orders with their status, date, total and a way to pay the unpaid one", async () => {
    serveOrders({
      "": () =>
        ordersResponse([
          orderSummary("a"),
          orderSummary("b", {
            status: "shipped",
            total: { amount: 250_000, currency: "IDR" },
          }),
        ]),
    });
    mount();

    expect(screen.getByRole("status").textContent).toBe("Memuat pesanan…");
    await screen.findByRole("list", { name: "Daftar pesanan" });

    const [unpaid, shipped] = rows();
    expect(
      within(nth(rows(), 0))
        .getByRole("link", { name: "GS-20261030-A" })
        .getAttribute("href"),
    ).toBe("/pesanan/a");
    expect(unpaid?.textContent).toContain("Menunggu pembayaran");
    expect(unpaid?.textContent).toContain(
      formatDateTime("2026-10-30T05:00:00Z"),
    );
    expect(unpaid?.textContent).toContain(rupiah(107_000));
    expect(
      within(nth(rows(), 0))
        .getByRole("link", { name: "Bayar pesanan GS-20261030-A" })
        .getAttribute("href"),
    ).toBe("/pesanan/a/pembayaran");

    expect(shipped?.textContent).toContain("Dikirim");
    expect(shipped?.textContent).toContain(rupiah(250_000));
    expect(
      within(nth(rows(), 1)).queryByRole("link", { name: /^Bayar/ }),
    ).toBeNull();
    expect(moreButton()).toBeNull();
    expect(cursors()).toEqual([""]);
  });

  it("says there are no orders yet and links to the catalog", async () => {
    serveOrders({ "": () => ordersResponse([]) });
    mount();

    const empty = await screen.findByText(/Anda belum punya pesanan\./);
    expect(empty.textContent).toBe("Anda belum punya pesanan. Mulai belanja.");
    expect(
      screen.getByRole("link", { name: "Mulai belanja" }).getAttribute("href"),
    ).toBe("/");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("loads the next page on request and moves the focus to its first order", async () => {
    const second = deferred<Response>();
    serveOrders({
      "": () => ordersResponse([orderSummary("a"), orderSummary("b")], "c2"),
      c2: () => second.promise,
    });
    const clicker = userEvent.setup();
    mount();
    await screen.findByRole("list", { name: "Daftar pesanan" });

    await clicker.click(loadMore());

    expect(moreButton()?.textContent).toBe("Memuat…");
    expect(moreButton()?.disabled).toBe(true);
    second.resolve(ordersResponse([orderSummary("c")], null));
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("GS-20261030-C");
    });
    expect(moreButton()).toBeNull();
    expect(cursors()).toEqual(["", "c2"]);
  });

  it("keeps the loaded orders when the next page fails, and retries that page", async () => {
    serveFlakySecondPage();
    const clicker = userEvent.setup();
    mount();
    await screen.findByRole("list", { name: "Daftar pesanan" });

    await clicker.click(loadMore());

    await waitFor(() => {
      expect(screen.queryAllByRole("alert")).not.toHaveLength(0);
    });
    expect(rows()).toHaveLength(1);
    expect(moreButton()).toBeNull();
    // The retry under the list, where the button was.
    const retry = nth(screen.getAllByRole("alert"), -1);
    expect(retry.compareDocumentPosition(nth(rows(), 0))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );

    await clicker.click(
      within(retry).getByRole("button", { name: "Coba lagi" }),
    );

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cursors()).toEqual(["", "c2", "c2"]);
  });

  // A failed next page puts the infinite query in status "error"
  // (TanStack Query v5); the whole-list alert must not show for it, or the
  // page says the same sentence twice with two "Coba lagi" buttons.
  it("shows one error, not two, for a failed next page", async () => {
    serveFlakySecondPage();
    const clicker = userEvent.setup();
    mount();
    await screen.findByRole("list", { name: "Daftar pesanan" });

    await clicker.click(loadMore());

    await waitFor(() => {
      expect(screen.queryAllByRole("alert")).not.toHaveLength(0);
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Memuat pesanan…")).toBeNull();
  });

  it("shows a failed first load with a retry", async () => {
    let failures = 1;
    serveOrders({
      "": () =>
        failures-- > 0
          ? errorResponse(500, "INTERNAL_ERROR", "req-9")
          : ordersResponse([orderSummary("a")]),
    });
    const clicker = userEvent.setup();
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
    expect(alert.textContent).toContain("req-9");

    await clicker.click(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    );

    expect(
      await screen.findByRole("link", { name: "GS-20261030-A" }),
    ).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
