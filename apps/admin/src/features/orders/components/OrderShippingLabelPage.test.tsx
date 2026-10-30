import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "@goshop/shared";
import { ORDER_ID, order } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { errorResponse } from "@/test/msw/http.ts";
import { orderDetailHandler, orderResponse } from "@/test/msw/orders.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { OrderShippingLabelPage } from "./OrderShippingLabelPage.tsx";

const renderLabel = (
  value: Order | Parameters<typeof orderDetailHandler>[0] = order(),
) => {
  server.use(orderDetailHandler(value));
  return renderRoute(<OrderShippingLabelPage />, {
    path: "/pesanan/:orderId/resi",
    url: `/pesanan/${ORDER_ID}/resi`,
  });
};

const label = () => screen.getByRole("region", { name: "Label pengiriman" });

describe("OrderShippingLabelPage", () => {
  it("disables Cetak until the order has loaded", async () => {
    const answer = deferred<Response>();
    renderLabel(() => answer.promise);

    expect(
      screen.getByRole("heading", { level: 1, name: "Resi pengiriman" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Memuat pesanan…");
    expect(screen.getByRole("button", { name: "Cetak" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Kembali ke pesanan" }),
    ).toHaveAttribute("href", `/pesanan/${ORDER_ID}`);
    expect(document.title).toBe("Resi — GoShop Admin");

    answer.resolve(orderResponse(order()));
    await screen.findByRole("region", { name: "Label pengiriman" });
    expect(screen.getByRole("button", { name: "Cetak" })).toBeEnabled();
  });

  it("prints with the browser's own dialog", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const userEvents = userEvent.setup();
    renderLabel();

    await screen.findByRole("region", { name: "Label pengiriman" });
    await userEvents.click(screen.getByRole("button", { name: "Cetak" }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it("puts the courier, the resi, the recipient, the sender and the weight on the label", async () => {
    renderLabel(
      order({
        status: "shipped",
        shipping: { ...order().shipping, tracking_number: "JNE0123456789" },
      }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: `Resi pengiriman ${order().code}`,
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe(`Resi ${order().code} — GoShop Admin`);
    const text = plain(label().textContent);
    expect(text).toContain("KurirJNE REG");
    expect(text).toContain("Nomor resiJNE0123456789");
    expect(text).toContain(
      "Budi Santoso081234567890Jl. Merdeka No. 1Bandung, Jawa Barat 40111",
    );
    expect(text).toContain("PengirimGoShop");
    expect(text).toContain("Berat1,25 kg");
    expect(text).toContain("StatusDikirim");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Nomor resi belum diisi/)).toBeNull();
  });

  it("leaves room for the resi, and says so, before the order is shipped", async () => {
    renderLabel(order({ status: "processing" }));
    await screen.findByRole("region", { name: "Label pengiriman" });

    expect(plain(label().textContent)).toContain("Nomor resi—");
    expect(screen.getByText(/Nomor resi belum diisi/)).toBeInTheDocument();
  });

  it.each([
    [
      "cancelled",
      order({ status: "cancelled" }),
      "Pesanan ini dibatalkan. Jangan dikirim.",
    ],
    [
      "unpaid",
      order({ status: "pending_payment", paid_at: null }),
      "Pesanan ini belum dibayar. Jangan dikirim sebelum lunas.",
    ],
  ])(
    "warns on the paper that a %s order must not leave",
    async (_name, value, text) => {
      renderLabel(value);

      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.queryByText(/Nomor resi belum diisi/)).toBeNull();
    },
  );

  it("lists every line with its SKU and quantity, without prices, and the total count", async () => {
    renderLabel();
    const slip = await screen.findByRole("region", {
      name: `Daftar barang — ${order().code}`,
    });

    const rows = within(slip).getAllByRole("row");
    expect(rows.map((row) => plain(row.textContent))).toEqual([
      "ProdukSKUJumlah",
      "Kaos Polos — Hitam / MKAOS-HTM-M2",
      "Topi Rajut — AbuTOPI-ABU1",
      "Jumlah barang3",
    ]);
    expect(slip).not.toHaveTextContent("Rp");
  });

  it("says the order was not found", async () => {
    renderLabel(() => errorResponse(404, "NOT_FOUND"));

    expect(
      await screen.findByText(
        "Pesanan ini tidak ditemukan. Mungkin alamatnya salah ketik.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cetak" })).toBeDisabled();
  });

  it("gives the page heading the focus when Coba lagi turns the error into loading, and keeps it there", async () => {
    let calls = 0;
    const second = deferred<Response>();
    const userEvents = userEvent.setup();
    renderLabel(() => {
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
      screen.getByRole("heading", { level: 1, name: /^Resi pengiriman/ }),
    ).toHaveFocus();

    second.resolve(orderResponse(order()));

    expect(
      await screen.findByRole("region", { name: "Label pengiriman" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /^Resi pengiriman/ }),
    ).toHaveFocus();
  });

  it("offers to try again after another failure", async () => {
    let calls = 0;
    const userEvents = userEvent.setup();
    renderLabel(() => {
      calls += 1;
      return calls === 1
        ? errorResponse(500, "INTERNAL_ERROR")
        : orderResponse(order());
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
    await userEvents.click(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    );

    expect(
      await screen.findByRole("region", { name: "Label pengiriman" }),
    ).toBeInTheDocument();
  });
});
