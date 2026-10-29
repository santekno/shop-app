import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { Order } from "@goshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setNavigationState } from "@/lib/navigation-state.ts";
import {
  latestPayment,
  order,
  orderDetailResponse,
  paymentResponse,
  paymentSession,
} from "@/test/checkout-fixtures.ts";
import {
  errorResponse,
  fetchMock,
  requestUrl,
  rupiah,
  user,
} from "@/test/fake-api.ts";
import { createTestQueryClient, renderWithProviders } from "@/test/render.tsx";
import { stubLocation } from "@/test/window-location.ts";
import { POLL_LIMIT_MS } from "../payment-polling.ts";
import { PaymentPage } from "./PaymentPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };
const PAGE = "/pesanan/order-1/pembayaran";
const NOW = Date.parse("2026-10-30T10:00:00Z");

const paid = (code: string): Partial<Order> => ({
  code,
  status: "paid",
  paid_at: "2026-10-30T10:00:05Z",
});

/** Every GET /v1/orders/order-1 so far. */
const gets = () =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      (init?.method ?? "GET") === "GET" &&
      requestUrl(input).pathname === "/v1/orders/order-1",
  ).length;

const pays = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/orders/order-1/pay",
  ).length;

/**
 * Answers GET /v1/orders/order-1 with each of `answers` in turn, the last
 * one for ever after; POST …/pay with `pay`.
 */
const serveOrder = (
  answers: (Partial<Order> | (() => Response))[],
  pay: () => Response = () => paymentResponse(paymentSession("order-1")),
) => {
  let n = 0;
  fetchMock.mockImplementation((input, init) => {
    const { pathname } = requestUrl(input);
    if (pathname === "/v1/orders/order-1/pay" && init?.method === "POST") {
      return Promise.resolve(pay());
    }
    if (pathname !== "/v1/orders/order-1") {
      return Promise.resolve(errorResponse(404, "NOT_FOUND"));
    }
    const next = answers[Math.min(n, answers.length - 1)] ?? {};
    n += 1;
    return Promise.resolve(
      typeof next === "function" ? next() : orderDetailResponse(order(next)),
    );
  });
};

const mount = (queryClient?: QueryClient) =>
  renderWithProviders(<PaymentPage />, {
    path: "/pesanan/[id]/pembayaran",
    url: PAGE,
    session,
    ...(queryClient === undefined ? {} : { queryClient }),
  });

const status = () => screen.getByRole("status").textContent;

/** Lets the clock run `ms` and every answer it brings arrive. */
const tick = async (ms: number) => {
  await act(() => vi.advanceTimersByTimeAsync(ms));
};

/**
 * Lets the clock run `ms` and the answers it brought reach the screen:
 * TanStack Query hands an answer to React on a timer of its own, which
 * the fake clock runs only once it moves on (one more millisecond).
 */
const advance = async (ms: number) => {
  await tick(ms);
  await tick(1);
};

const gtag = vi.fn();
const purchases = () =>
  gtag.mock.calls
    .filter(([, name]) => name === "purchase")
    .map(
      ([, , params]) => (params as { transaction_id: string }).transaction_id,
    );

beforeEach(() => {
  fetchMock.mockReset();
  gtag.mockReset();
  window.gtag = gtag;
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  delete window.gtag;
});

describe("PaymentPage", () => {
  it("shows the waiting order, its total, a link to it and the pay button", async () => {
    serveOrder([{}]);
    mount();

    expect(screen.getByRole("status").textContent).toBe("Memuat pesanan…");
    await advance(0);

    expect(status()).toBe("Menunggu pembayaran.");
    expect(
      screen
        .getByRole("link", { name: "GS-20261030-7KQ2M9" })
        .getAttribute("href"),
    ).toBe("/pesanan/order-1");
    expect(document.body.textContent).toContain(
      `GS-20261030-7KQ2M9 · Total ${rupiah(107_000)}`,
    );
    expect(screen.getByText(/^Diperiksa otomatis\./)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Bayar sekarang" }),
    ).toBeDefined();
    expect(screen.queryByText(/Mode uji/)).toBeNull();
  });

  it("asks again with a growing delay while the order waits", async () => {
    serveOrder([{}]);
    mount();
    await tick(0);
    expect(gets()).toBe(1);

    // 2 s, 2 s, 3 s, 5 s, 8 s after each answer.
    const seen: number[] = [];
    for (const wait of [2_000, 2_000, 3_000, 5_000, 8_000]) {
      await tick(wait - 1);
      seen.push(gets());
      await tick(1);
      seen.push(gets());
    }

    expect(seen).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6]);
  });

  // The order's cache entry outlives the page; a round counts its own
  // answers, so a page opened again in the same visit starts at 2 s, not
  // at the 30 s its last visit had reached.
  it("starts at 2 s again when the page is opened again in the same visit", async () => {
    serveOrder([{}]);
    const queryClient = createTestQueryClient();
    const first = mount(queryClient);
    await tick(0);
    for (const wait of [2_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000]) {
      await tick(wait);
    }
    expect(gets()).toBe(8);
    first.unmount();

    mount(queryClient);
    await tick(0);
    const opened = gets();
    await tick(2_000);

    expect(gets()).toBe(opened + 1);
  });

  it("stops asking once the order is paid, and reports the purchase once", async () => {
    serveOrder([{ code: "GS-PAID-1" }, paid("GS-PAID-1")]);
    mount();
    await advance(0);
    expect(purchases()).toEqual([]);

    await advance(2_000);

    expect(status()).toBe("Pembayaran diterima. Terima kasih!");
    expect(gets()).toBe(2);
    expect(purchases()).toEqual(["GS-PAID-1"]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Diperiksa otomatis/)).toBeNull();

    await advance(10 * 60_000);
    expect(gets()).toBe(2);
    expect(purchases()).toEqual(["GS-PAID-1"]);
  });

  it("does not report the purchase again when the paid order is opened again", async () => {
    serveOrder([paid("GS-PAID-2")]);
    const first = mount();
    await advance(0);
    expect(purchases()).toEqual(["GS-PAID-2"]);
    first.unmount();

    mount();
    await advance(0);

    expect(status()).toBe("Pembayaran diterima. Terima kasih!");
    expect(purchases()).toEqual(["GS-PAID-2"]);
  });

  it.each([
    [
      "expired",
      { status: "cancelled", cancel_reason: "payment_expired" } as const,
      "Waktu pembayaran habis. Pesanan dibatalkan dan stoknya dikembalikan.",
    ],
    [
      "cancelled",
      { status: "cancelled", cancel_reason: "seller_cancelled" } as const,
      "Pesanan ini dibatalkan.",
    ],
  ])(
    "stops asking once the order is %s, and offers no payment",
    async (_, final, text) => {
      serveOrder([{}, final]);
      mount();
      await advance(0);

      await advance(2_000);

      expect(status()).toBe(text);
      await advance(10 * 60_000);
      expect(gets()).toBe(2);
      expect(screen.queryByRole("button")).toBeNull();
      expect(purchases()).toEqual([]);
    },
  );

  it("keeps asking while Midtrans' paid answer is being confirmed, without a pay button", async () => {
    serveOrder([{ latest_payment: latestPayment("paid") }]);
    mount();
    await advance(0);

    expect(status()).toBe("Pembayaran sedang dikonfirmasi…");
    expect(screen.queryByRole("button")).toBeNull();
    await advance(2_000);
    expect(gets()).toBe(2);
  });

  it("keeps asking after a refused payment, and offers to pay again", async () => {
    serveOrder([{ latest_payment: latestPayment("denied") }]);
    mount();
    await advance(0);

    expect(status()).toBe(
      "Pembayaran ditolak. Coba lagi, dengan metode pembayaran lain bila perlu.",
    );
    expect(
      screen.getByRole("button", { name: "Coba bayar lagi" }),
    ).toBeDefined();
    await advance(2_000);
    expect(gets()).toBe(2);
  });

  it("offers 'Lanjutkan pembayaran' for a payment still open", async () => {
    serveOrder([{ latest_payment: latestPayment("pending") }]);
    mount();
    await advance(0);

    expect(
      screen.getByRole("button", { name: "Lanjutkan pembayaran" }),
    ).toBeDefined();
  });

  it("pays again from the page, replacing its own history entry", async () => {
    vi.useRealTimers();
    const location = stubLocation();
    const replaces = vi.spyOn(window.history, "replaceState");
    serveOrder([{ latest_payment: latestPayment("expired") }]);
    const clicker = userEvent.setup();
    mount();

    await clicker.click(
      await screen.findByRole("button", { name: "Coba bayar lagi" }),
    );

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(
        "https://app.sandbox.midtrans.com/snap/v4/redirection/abc",
      );
    });
    expect(replaces).toHaveBeenLastCalledWith(null, "", PAGE);
    expect(pays()).toBe(1);
    replaces.mockRestore();
  });

  it("says why paying again failed", async () => {
    vi.useRealTimers();
    serveOrder([{ latest_payment: latestPayment("failed") }], () =>
      errorResponse(409, "INVALID_TRANSITION"),
    );
    const clicker = userEvent.setup();
    mount();

    await clicker.click(
      await screen.findByRole("button", { name: "Coba bayar lagi" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pesanan ini sudah tidak menunggu pembayaran.",
    );
  });

  it.each([
    ["two minutes", NOW + 2 * 60_000],
    ["one minute", NOW + 60_000],
  ])(
    "offers no payment with %s left before the deadline",
    async (_, deadline) => {
      serveOrder([{ payment_expires_at: new Date(deadline).toISOString() }]);
      mount();
      await advance(0);

      expect(status()).toBe("Menunggu pembayaran.");
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it("still offers payment with just over two minutes left", async () => {
    serveOrder([
      { payment_expires_at: new Date(NOW + 2 * 60_000 + 1_000).toISOString() },
    ]);
    mount();
    await advance(0);

    expect(
      screen.getByRole("button", { name: "Bayar sekarang" }),
    ).toBeDefined();
  });

  it("says the deadline passed and keeps asking until the expiry job decides", async () => {
    serveOrder([
      { payment_expires_at: new Date(NOW + 1_000).toISOString() },
      { payment_expires_at: new Date(NOW + 1_000).toISOString() },
      { status: "cancelled", cancel_reason: "payment_expired" },
    ]);
    mount();
    await advance(0);
    expect(status()).toBe("Menunggu pembayaran.");

    await advance(2_000);
    expect(status()).toBe(
      "Batas waktu pembayaran sudah lewat. Menunggu konfirmasi akhir…",
    );
    await advance(2_000);
    expect(status()).toBe(
      "Waktu pembayaran habis. Pesanan dibatalkan dan stoknya dikembalikan.",
    );
    expect(gets()).toBe(3);
  });

  it("stops by itself after a round of polling, and 'Periksa lagi' starts another", async () => {
    serveOrder([{}]);
    mount();
    await advance(0);

    await advance(POLL_LIMIT_MS + 60_000);

    expect(screen.getByText(/^Pemeriksaan otomatis berhenti\./)).toBeDefined();
    const stoppedAt = gets();
    await advance(5 * 60_000);
    expect(gets()).toBe(stoppedAt);

    fireEvent.click(screen.getByRole("button", { name: "Periksa lagi" }));
    await advance(0);

    expect(gets()).toBe(stoppedAt + 1);
    expect(screen.queryByRole("button", { name: "Periksa lagi" })).toBeNull();
    expect(screen.getByText(/^Diperiksa otomatis\./)).toBeDefined();
    // The new round starts from the fast end of the backoff again: the
    // buyer pressed it because they have just paid.
    await advance(2_000);
    expect(gets()).toBe(stoppedAt + 2);
    await advance(2_000);
    expect(gets()).toBe(stoppedAt + 3);
    await advance(3_000);
    expect(gets()).toBe(stoppedAt + 4);
    await advance(POLL_LIMIT_MS + 60_000);
    expect(screen.getByText(/^Pemeriksaan otomatis berhenti\./)).toBeDefined();
  });

  it("does not ask while the tab is hidden, and asks at once when it is shown", async () => {
    serveOrder([{}]);
    mount();
    await advance(0);

    act(() => {
      focusManager.setFocused(false);
    });
    // Ten seconds: past several poll delays, and well within the
    // storefront's default staleTime, which this query must not use.
    await advance(10_000);
    expect(gets()).toBe(1);

    act(() => {
      focusManager.setFocused(true);
    });
    await advance(0);
    expect(gets()).toBe(2);
  });

  it("stops asking when the buyer leaves the page", async () => {
    serveOrder([{}]);
    const view = mount();
    await advance(0);

    view.unmount();
    await advance(60_000);

    expect(gets()).toBe(1);
  });

  it("shows a failed check with a retry, keeps asking, and recovers", async () => {
    serveOrder([
      {},
      () => errorResponse(500, "INTERNAL_ERROR", "req-7"),
      { latest_payment: latestPayment("pending") },
    ]);
    mount();
    await advance(0);

    await advance(2_000);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
    expect(alert.textContent).toContain("req-7");

    await advance(2_000);
    expect(gets()).toBe(3);
    expect(status()).toBe("Menunggu pembayaran.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retries a first load that failed when the buyer asks", async () => {
    serveOrder([() => errorResponse(500, "INTERNAL_ERROR"), {}]);
    mount();
    await advance(0);
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await advance(0);

    expect(status()).toBe("Menunggu pembayaran.");
    expect(gets()).toBe(2);
  });

  it.each([
    ["an order that does not exist", "missing"],
    ["another buyer's order (the API answers 404 too)", "someone else's"],
  ])("says %s is not found, and asks no more", async () => {
    serveOrder([() => errorResponse(404, "NOT_FOUND")]);
    mount();
    await advance(0);

    expect(screen.getByRole("alert").textContent).toBe(
      "Pesanan ini tidak ditemukan.",
    );
    expect(screen.queryByRole("button")).toBeNull();
    await advance(60_000);
    expect(gets()).toBe(1);
  });

  it("says the order was placed but the payment could not start", async () => {
    setNavigationState(PAGE, {
      payError: "Pembayaran sedang tidak tersedia di toko ini.",
    });
    serveOrder([{}]);
    mount();
    await advance(0);

    expect(screen.getAllByRole("alert")[0]?.textContent).toBe(
      "Pesanan sudah dibuat, tetapi pembayaran belum bisa dimulai: Pembayaran sedang tidak tersedia di toko ini.",
    );
    expect(
      screen.getByRole("button", { name: "Bayar sekarang" }),
    ).toBeDefined();
  });

  it("shows how to pay with the test gateway while the order waits, not after", async () => {
    setNavigationState(PAGE, { fakeProvider: true });
    serveOrder([{}, paid("GS-PAID-3")]);
    mount();
    await advance(0);

    expect(
      screen.getByText("make fake-pay order=GS-20261030-7KQ2M9"),
    ).toBeDefined();

    await advance(2_000);
    expect(status()).toBe("Pembayaran diterima. Terima kasih!");
    expect(screen.queryByText(/Mode uji/)).toBeNull();
  });
});
