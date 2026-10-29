import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Order } from "@goshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { renderWithProviders } from "@/test/render.tsx";
import { stubLocation } from "@/test/window-location.ts";
import { formatDateTime } from "../format.ts";
import { OrderDetailPage } from "./OrderDetailPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };
const NOW = Date.parse("2026-10-30T10:00:00Z");

const idr = (amount: number) => ({ amount, currency: "IDR" as const });

/** Answers GET /v1/orders/order-1 with `answers` in turn, the last for ever. */
const serveOrder = (...answers: (() => Response)[]) => {
  let n = 0;
  fetchMock.mockImplementation((input, init) => {
    const { pathname } = requestUrl(input);
    if (pathname === "/v1/orders/order-1/pay" && init?.method === "POST") {
      return Promise.resolve(paymentResponse(paymentSession("order-1")));
    }
    const answer = answers[Math.min(n, answers.length - 1)];
    n += 1;
    return Promise.resolve(
      pathname === "/v1/orders/order-1" && answer !== undefined
        ? answer()
        : errorResponse(404, "NOT_FOUND"),
    );
  });
};
const serve = (overrides: Partial<Order> = {}) => {
  serveOrder(() => orderDetailResponse(order(overrides)));
};

const mount = () =>
  renderWithProviders(<OrderDetailPage />, {
    path: "/pesanan/[id]",
    url: "/pesanan/order-1",
    session,
  });

const loaded = () =>
  screen.findByRole("list", { name: "Barang dalam pesanan" });
const section = (title: string) =>
  screen.getByRole("heading", { name: title }).closest("section") ??
  document.body;
/** The <dd> after the <dt> named `term`. */
const value = (term: string) =>
  screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrderDetailPage", () => {
  it("shows the order's own copy: lines, totals, shipping and history", async () => {
    serve({
      items: [
        {
          id: "i1",
          variant_id: "v1",
          product_name: "Kaos Polos",
          variant_name: "M",
          sku: "KAOS-M",
          unit_price: idr(89_000),
          quantity: 2,
          line_total: idr(178_000),
        },
      ],
      totals: {
        subtotal: idr(178_000),
        discount: idr(15_000),
        shipping_fee: idr(18_000),
        total: idr(181_000),
        weight_grams: 400,
      },
      voucher_code: "POTONG15RB",
    });
    mount();

    expect(screen.getByRole("status").textContent).toBe("Memuat pesanan…");
    const items = await loaded();

    expect(screen.getByText("GS-20261030-7KQ2M9").tagName).toBe("STRONG");
    expect(screen.getAllByText("Menunggu pembayaran")).toHaveLength(1);
    expect(within(items).getByRole("listitem").textContent).toBe(
      `Kaos Polos (M) · 2 × ${rupiah(89_000)}${rupiah(178_000)}`,
    );
    expect(value("Subtotal")).toBe(rupiah(178_000));
    expect(value("Diskon voucher POTONG15RB")).toBe(`−${rupiah(15_000)}`);
    expect(value("Ongkos kirim")).toBe(rupiah(18_000));
    expect(value("Total")).toBe(rupiah(181_000));
    expect(value("Kurir")).toBe("JNE REG");
    expect(value("Nomor resi")).toBe("Belum dikirim");
    expect(value("Alamat")).toBe(
      "Budi Santoso · 081234567890Jl. Merdeka 1, Bandung, Jawa Barat 40111",
    );
    const history = within(section("Riwayat")).getAllByRole("listitem");
    expect(history.map((item) => item.textContent)).toEqual([
      `Dibuat${formatDateTime("2026-10-30T00:00:00Z")}`,
    ]);
    expect(
      screen.getByRole("link", { name: "← Pesanan saya" }).getAttribute("href"),
    ).toBe("/pesanan");
  });

  it("offers to pay a waiting order, with its deadline and payment page", async () => {
    serve();
    mount();
    await loaded();

    expect(screen.getByText(/^Bayar sebelum/).textContent).toBe(
      `Bayar sebelum ${formatDateTime("2026-10-31T00:00:00Z")}. Lihat status pembayaran`,
    );
    expect(
      screen
        .getByRole("link", { name: "Lihat status pembayaran" })
        .getAttribute("href"),
    ).toBe("/pesanan/order-1/pembayaran");
    expect(
      screen.getByRole("button", { name: "Bayar sekarang" }),
    ).toBeDefined();
  });

  it("pays from the order's page, adding the payment page to the history", async () => {
    const location = stubLocation();
    const pushes = vi.spyOn(window.history, "pushState");
    serve({ latest_payment: latestPayment("cancelled") });
    const clicker = userEvent.setup();
    mount();
    await loaded();

    await clicker.click(
      screen.getByRole("button", { name: "Coba bayar lagi" }),
    );

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(
        "https://app.sandbox.midtrans.com/snap/v4/redirection/abc",
      );
    });
    expect(pushes).toHaveBeenCalledWith(
      null,
      "",
      "/pesanan/order-1/pembayaran",
    );
  });

  it.each([
    ["Midtrans has said paid", { latest_payment: latestPayment("paid") }],
    [
      "less than two minutes are left",
      { payment_expires_at: new Date(NOW + 90_000).toISOString() },
    ],
  ])("offers no payment when %s", async (_, overrides: Partial<Order>) => {
    serve(overrides);
    mount();
    await loaded();

    expect(screen.getByText(/^Bayar sebelum/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why a cancelled order was cancelled, with no payment offered", async () => {
    serve({
      status: "cancelled",
      cancel_reason: "payment_expired",
      cancelled_at: "2026-10-31T00:01:00Z",
    });
    mount();
    await loaded();

    expect(
      screen.getByText("Dibatalkan: waktu pembayaran habis.").tagName,
    ).toBe("P");
    expect(screen.queryByText(/^Bayar sebelum/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      within(section("Riwayat"))
        .getAllByRole("listitem")
        .map((item) => item.firstChild?.textContent),
    ).toEqual(["Dibuat", "Dibatalkan"]);
  });

  it("shows a shipped order's courier, airway bill and every step so far", async () => {
    serve({
      status: "shipped",
      paid_at: "2026-10-30T01:00:00Z",
      shipped_at: "2026-10-30T02:00:00Z",
      shipping: {
        ...order().shipping,
        courier: "jnt",
        service: "EZ",
        tracking_number: "JT0012345678",
      },
    });
    mount();
    await loaded();

    expect(value("Kurir")).toBe("J&T Express EZ");
    expect(value("Nomor resi")).toBe("JT0012345678");
    expect(screen.queryByText(/^Diskon/)).toBeNull();
    expect(screen.queryByText(/^Bayar sebelum/)).toBeNull();
    expect(
      within(section("Riwayat"))
        .getAllByRole("listitem")
        .map((item) => item.firstChild?.textContent),
    ).toEqual(["Dibuat", "Dibayar", "Dikirim"]);
    const shipped = within(section("Riwayat")).getAllByRole("listitem")[2];
    expect(shipped?.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-10-30T02:00:00Z",
    );
  });

  it("names a discount without a voucher code plainly, and SiCepat by its name", async () => {
    serve({
      status: "completed",
      completed_at: "2026-11-02T00:00:00Z",
      totals: { ...order().totals, discount: idr(5_000) },
      voucher_code: null,
      shipping: { ...order().shipping, courier: "sicepat", service: "BEST" },
    });
    mount();
    await loaded();

    expect(value("Diskon")).toBe(`−${rupiah(5_000)}`);
    expect(value("Kurir")).toBe("SiCepat BEST");
    expect(screen.getAllByText("Selesai").length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["an order that does not exist", "missing"],
    ["another buyer's order (the API answers 404 too)", "someone else's"],
  ])("says %s is not found", async () => {
    serveOrder(() => errorResponse(404, "NOT_FOUND"));
    mount();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pesanan ini tidak ditemukan.",
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Barang" })).toBeNull();
  });

  it("shows another error with a retry that loads the order", async () => {
    serveOrder(
      () => errorResponse(503, "UPSTREAM_UNAVAILABLE"),
      () => orderDetailResponse(order()),
    );
    const clicker = userEvent.setup();
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Coba lagi");
    await clicker.click(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    );

    await loaded();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
