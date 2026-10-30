import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Order } from "@goshop/shared";
import { formatDateTime } from "@/lib/format-date.ts";
import { ORDER_ID, order } from "@/test/fixtures.ts";
import { errorResponse } from "@/test/msw/http.ts";
import { orderDetailHandler, orderResponse } from "@/test/msw/orders.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { deferred } from "@/test/deferred.ts";
import { MAIN_ID } from "@/app/useRouteFocus.ts";
import { plain } from "@/test/text.ts";
import { OrderDetailPage } from "./OrderDetailPage.tsx";

const renderPage = (
  value: Order | Parameters<typeof orderDetailHandler>[0] = order(),
) => {
  server.use(orderDetailHandler(value));
  // In <main>, as DashboardLayout renders it: "Coba lagi" focuses the
  // page's heading through it.
  return renderRoute(
    <main id={MAIN_ID} tabIndex={-1}>
      <OrderDetailPage />
    </main>,
    {
      path: "/pesanan/:orderId",
      url: `/pesanan/${ORDER_ID}`,
    },
  );
};

const section = (name: string) => screen.getByRole("region", { name });

/** The page's title block: the heading, the code and the status badge. */
const header = () => {
  const block = screen.getByRole("heading", {
    level: 1,
    name: "Detail pesanan",
  }).parentElement;
  if (block === null) throw new Error("no header");
  return block;
};

describe("OrderDetailPage", () => {
  it("says it is loading, then shows the order's code and status", async () => {
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Memuat pesanan…");
    expect(await screen.findByText(order().code)).toBeInTheDocument();
    expect(within(header()).getByText("Dibayar")).toBeInTheDocument();
    expect(document.title).toBe(`Pesanan ${order().code} — GoShop Admin`);
    expect(screen.getByRole("link", { name: "Cetak resi" })).toHaveAttribute(
      "href",
      `/pesanan/${ORDER_ID}/resi`,
    );
  });

  it("says the order was not found, with the way back", async () => {
    renderPage(() => errorResponse(404, "NOT_FOUND"));

    expect(
      await screen.findByText(
        "Pesanan ini tidak ditemukan. Mungkin alamatnya salah ketik.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Kembali ke daftar pesanan" }),
    ).toHaveAttribute("href", "/pesanan");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.title).toBe("Detail pesanan — GoShop Admin");
  });

  it("offers to try again after any other failure", async () => {
    let calls = 0;
    const userEvents = userEvent.setup();
    renderPage(() => {
      calls += 1;
      return calls === 1
        ? errorResponse(500, "INTERNAL_ERROR")
        : orderResponse(order());
    });

    const alert = await screen.findByRole("alert");
    await userEvents.click(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    );

    expect(await screen.findByText(order().code)).toBeInTheDocument();
  });

  it("gives the page heading the focus when Coba lagi turns the error into loading, and keeps it there", async () => {
    let calls = 0;
    const second = deferred<Response>();
    const userEvents = userEvent.setup();
    renderPage(() => {
      calls += 1;
      return calls === 1
        ? errorResponse(500, "INTERNAL_ERROR")
        : second.promise;
    });
    const retry = within(await screen.findByRole("alert")).getByRole("button", {
      name: "Coba lagi",
    });
    retry.focus();

    await userEvents.keyboard("{Enter}");

    await waitFor(() => {
      expect(retry).not.toBeInTheDocument();
    });
    expect(screen.getByText("Memuat pesanan…")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Detail pesanan" }),
    ).toHaveFocus();

    second.resolve(orderResponse(order()));

    expect(await screen.findByText(order().code)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Detail pesanan" }),
    ).toHaveFocus();
  });

  it("lists what was bought, with the totals, and no discount row without one", async () => {
    renderPage();
    const items = await screen.findByRole("region", {
      name: "Barang yang dipesan",
    });

    const rows = within(items).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(plain(rows[1]?.textContent)).toBe(
      "Kaos PolosHitam / MKAOS-HTM-MRp 89.0002Rp 178.000",
    );
    const totals = section("Barang");
    expect(plain(totals.textContent)).toContain("SubtotalRp 223.000");
    expect(plain(totals.textContent)).toContain(
      "Ongkos kirim (1,25 kg)Rp 18.000",
    );
    expect(plain(totals.textContent)).toContain("TotalRp 241.000");
    expect(totals).not.toHaveTextContent("Diskon");
  });

  it("shows the discount with its voucher when there is one", async () => {
    renderPage(
      order({
        voucher_code: "HEMAT10",
        totals: {
          ...order().totals,
          discount: { amount: 22_300, currency: "IDR" },
        },
      }),
    );

    await screen.findByText(order().code);
    expect(plain(section("Barang").textContent)).toContain(
      "Diskon (voucher HEMAT10)−Rp 22.300",
    );
  });

  it("shows the courier, the resi or its absence, and the address", async () => {
    renderPage();
    await screen.findByText(order().code);

    const shipping = section("Pengiriman");
    expect(shipping).toHaveTextContent("JNE REG");
    expect(shipping).toHaveTextContent(
      "Belum ada; diisi saat pesanan dikirim.",
    );
    expect(within(shipping).getByText("Budi Santoso")).toBeInTheDocument();
    expect(shipping).toHaveTextContent("Bandung, Jawa Barat 40111");
  });

  it("shows the resi once the order has one", async () => {
    renderPage(
      order({
        status: "shipped",
        shipping: { ...order().shipping, tracking_number: "JNE0123456789" },
      }),
    );
    await screen.findByText(order().code);

    expect(section("Pengiriman")).toHaveTextContent("JNE0123456789");
    expect(section("Pengiriman")).not.toHaveTextContent("Belum ada");
  });

  it("shows how it was paid and when", async () => {
    renderPage(
      order({
        latest_payment: { status: "paid" } as Order["latest_payment"],
      }),
    );
    await screen.findByText(order().code);

    const payment = section("Pembayaran");
    expect(payment).toHaveTextContent("Lunas");
    expect(payment).toHaveTextContent(
      `Dibayar${formatDateTime(order().paid_at ?? "")}`,
    );
    expect(payment).not.toHaveTextContent("Batas bayar");
  });

  it("shows the payment deadline for an unpaid order", async () => {
    renderPage(order({ status: "pending_payment", paid_at: null }));
    await screen.findByText(order().code);

    const payment = section("Pembayaran");
    expect(payment).toHaveTextContent("Pembeli belum mulai membayar");
    expect(payment).toHaveTextContent(
      `Batas bayar${formatDateTime(order().payment_expires_at)}`,
    );
  });

  it("shows neither time for an order cancelled before it was paid", async () => {
    renderPage(
      order({
        status: "cancelled",
        cancel_reason: "payment_expired",
        paid_at: null,
      }),
    );
    await screen.findByText(order().code);

    expect(section("Pembayaran")).not.toHaveTextContent("Batas bayar");
    expect(
      within(header()).getByText("Dibatalkan (waktu pembayaran habis)"),
    ).toBeInTheDocument();
  });

  it("shows the history with the current step marked, and links to the order's queue", async () => {
    renderPage(order({ status: "processing" }));
    await screen.findByText(order().code);

    const history = section("Riwayat");
    const steps = within(history).getAllByRole("listitem");
    expect(steps.map((step) => plain(step.textContent).split(" (")[0])).toEqual(
      ["Dipesan", "Dibayar", "Diproses", "Dikirim", "Selesai"],
    );
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[2]).toHaveTextContent("(sekarang)");
    expect(steps[0]).toHaveTextContent("(sudah)");
    expect(steps[3]).toHaveTextContent("(belum)");
    expect(
      screen.getByRole("link", { name: "Lihat antrean “Diproses”" }),
    ).toHaveAttribute("href", "/pesanan?status=diproses");
  });

  it("fetches the order with the session's token", async () => {
    const { recordRequests } = await import("@/test/msw/http.ts");
    const sent = recordRequests();
    renderPage();

    await screen.findByText(order().code);
    await waitFor(() => {
      expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
    });
    expect(sent[0]?.url.pathname).toBe(`/v1/admin/orders/${ORDER_ID}`);
  });
});
