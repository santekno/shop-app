import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Order } from "@goshop/shared";
import { ORDER_ID, order, session, user, webSession } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { sessionResponse, webRefreshHandler } from "@/test/msw/auth.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  orderActionHandler,
  orderDetailHandler,
  orderResponse,
} from "@/test/msw/orders.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { OrderDetailPage } from "./OrderDetailPage.tsx";

/**
 * The detail page with `value` as the order the API holds; `after` is
 * what a later GET returns (a refetch after a 409).
 */
const renderPanel = (
  value: Order,
  { role = "admin", after }: { role?: "admin" | "seller"; after?: Order } = {},
) => {
  let gets = 0;
  server.use(
    orderDetailHandler(() => {
      gets += 1;
      return orderResponse(gets > 1 && after !== undefined ? after : value);
    }),
  );
  const view = renderRoute(<OrderDetailPage />, {
    path: "/pesanan/:orderId",
    url: `/pesanan/${ORDER_ID}`,
    session: session(role),
  });
  return { ...view, gets: () => gets };
};

const panel = () => screen.getByRole("region", { name: "Tindakan" });
const badge = () => {
  const block = screen.getByRole("heading", {
    level: 1,
    name: "Detail pesanan",
  }).parentElement;
  if (block === null) throw new Error("no header");
  return block;
};
const loaded = () => screen.findByRole("region", { name: "Tindakan" });

describe("OrderActionsPanel", () => {
  describe("what it offers", () => {
    it("offers an admin process and cancel for a paid order", async () => {
      renderPanel(order({ status: "paid" }));
      await loaded();

      expect(
        within(panel())
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(["Proses pesanan", "Batalkan pesanan"]);
    });

    it("offers a seller no cancel, and says the admin cancels orders", async () => {
      renderPanel(order({ status: "paid" }), { role: "seller" });
      await loaded();

      expect(
        within(panel()).getByRole("button", { name: "Proses pesanan" }),
      ).toBeInTheDocument();
      expect(
        within(panel()).queryByRole("button", { name: "Batalkan pesanan" }),
      ).toBeNull();
      expect(panel()).toHaveTextContent(
        "Pembatalan pesanan dilakukan oleh admin toko.",
      );
    });

    it("tells a seller an unpaid order waits for the buyer", async () => {
      renderPanel(order({ status: "pending_payment", paid_at: null }), {
        role: "seller",
      });
      await loaded();

      expect(panel()).toHaveTextContent("Menunggu pembeli membayar.");
      expect(within(panel()).queryAllByRole("button")).toEqual([]);
    });

    it("says nothing more can happen to a completed order, without the cancel note", async () => {
      renderPanel(order({ status: "completed" }), { role: "seller" });
      await loaded();

      expect(panel()).toHaveTextContent(
        "Tidak ada tindakan lagi untuk pesanan ini.",
      );
      expect(panel()).not.toHaveTextContent(
        "Pembatalan pesanan dilakukan oleh admin toko.",
      );
    });
  });

  describe("Proses pesanan", () => {
    it("runs at once, says what happened, focuses the heading, and shows the new status", async () => {
      const sent = recordRequests();
      server.use(
        orderActionHandler("process", () =>
          orderResponse(order({ status: "processing" })),
        ),
      );
      const userEvents = userEvent.setup();
      renderPanel(order({ status: "paid" }));
      await loaded();

      await userEvents.click(
        screen.getByRole("button", { name: "Proses pesanan" }),
      );

      expect(await within(panel()).findByRole("status")).toHaveTextContent(
        `Pesanan ${order().code} sedang diproses. Kemas barangnya, lalu kirim dengan nomor resi.`,
      );
      expect(screen.getByRole("heading", { name: "Tindakan" })).toHaveFocus();
      expect(within(badge()).getByText("Diproses")).toBeInTheDocument();
      expect(
        screen.getByRole("form", { name: "Kirim pesanan" }),
      ).toBeInTheDocument();
      const post = sent.find((r) => r.method === "POST");
      expect(post?.url.pathname).toBe(`/v1/admin/orders/${ORDER_ID}/process`);
      expect(post?.headers.get("Authorization")).toBe("Bearer token-1");
    });

    it("says 'Memproses…' and disables every action while it runs", async () => {
      const answer = deferred<Response>();
      server.use(orderActionHandler("process", () => answer.promise));
      const userEvents = userEvent.setup();
      renderPanel(order({ status: "paid" }));
      await loaded();

      await userEvents.click(
        screen.getByRole("button", { name: "Proses pesanan" }),
      );

      expect(
        await screen.findByRole("button", { name: "Memproses…" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Batalkan pesanan" }),
      ).toBeDisabled();
      answer.resolve(orderResponse(order({ status: "processing" })));
      expect(await within(panel()).findByRole("status")).toHaveTextContent(
        "sedang diproses",
      );
    });

    it("says someone else moved the order, naming its status, and shows the refetched order", async () => {
      server.use(
        orderActionHandler("process", () =>
          errorResponse(409, "INVALID_TRANSITION", {
            details: { status: "cancelled", to: "processing" },
          }),
        ),
      );
      const userEvents = userEvent.setup();
      const { gets } = renderPanel(order({ status: "paid" }), {
        after: order({ status: "cancelled", cancel_reason: "buyer_cancelled" }),
      });
      await loaded();

      await userEvents.click(
        screen.getByRole("button", { name: "Proses pesanan" }),
      );

      const alert = await within(panel()).findByRole("alert");
      expect(alert).toHaveTextContent(
        "Pesanan ini sudah diubah orang lain: statusnya sekarang “Dibatalkan”.",
      );
      expect(alert).toHaveFocus();
      expect(gets()).toBe(2);
      expect(
        within(badge()).getByText("Dibatalkan (dibatalkan pembeli)"),
      ).toBeInTheDocument();
      expect(
        within(panel()).queryByRole("button", { name: "Proses pesanan" }),
      ).toBeNull();
    });

    it("says the order did not change after a server error, keeping the button", async () => {
      server.use(
        orderActionHandler("process", () =>
          errorResponse(500, "INTERNAL_ERROR"),
        ),
      );
      const userEvents = userEvent.setup();
      const { gets } = renderPanel(order({ status: "paid" }));
      await loaded();

      await userEvents.click(
        screen.getByRole("button", { name: "Proses pesanan" }),
      );

      expect(await within(panel()).findByRole("alert")).toHaveTextContent(
        "Pesanan belum berubah karena kesalahan di server. Coba lagi.",
      );
      expect(
        screen.getByRole("button", { name: "Proses pesanan" }),
      ).toBeEnabled();
      expect(gets()).toBe(1);
    });

    it("moves the focus to a second identical failure too", async () => {
      server.use(
        orderActionHandler("process", () =>
          errorResponse(500, "INTERNAL_ERROR"),
        ),
      );
      const userEvents = userEvent.setup();
      renderPanel(order({ status: "paid" }));
      await loaded();
      const button = screen.getByRole("button", { name: "Proses pesanan" });

      await userEvents.click(button);
      await waitFor(() => {
        expect(within(panel()).getByRole("alert")).toHaveFocus();
      });
      button.focus();
      await userEvents.click(button);

      await waitFor(() => {
        expect(within(panel()).getByRole("alert")).toHaveFocus();
      });
    });
  });

  describe("Batalkan pesanan", () => {
    const openCancel = async () => {
      const userEvents = userEvent.setup();
      await loaded();
      await userEvents.click(
        screen.getByRole("button", { name: "Batalkan pesanan" }),
      );
      const dialog = screen.getByRole("alertdialog", {
        name: `Batalkan pesanan ${order().code}?`,
      });
      return { userEvents, dialog };
    };

    it("asks first, focusing 'Jangan batalkan', and warns the money is not refunded", async () => {
      renderPanel(order({ status: "paid" }));
      const { dialog } = await openCancel();

      expect(dialog).toHaveAttribute("open");
      expect(
        within(dialog).getByRole("button", { name: "Jangan batalkan" }),
      ).toHaveFocus();
      expect(dialog).toHaveAccessibleDescription(
        /Stok barangnya kembali tersedia/,
      );
      expect(dialog).toHaveTextContent(
        "uang pembeli tidak dikembalikan otomatis",
      );
    });

    it("leaves out the refund sentence for an order never paid", async () => {
      renderPanel(order({ status: "pending_payment", paid_at: null }));
      const { dialog } = await openCancel();

      expect(dialog).not.toHaveTextContent("uang pembeli");
    });

    it("closes without a request from 'Jangan batalkan'", async () => {
      const sent = recordRequests();
      renderPanel(order({ status: "paid" }));
      const { userEvents, dialog } = await openCancel();

      await userEvents.click(
        within(dialog).getByRole("button", { name: "Jangan batalkan" }),
      );

      expect(dialog).not.toHaveAttribute("open");
      expect(sent.filter((r) => r.method === "POST")).toEqual([]);
    });

    it("closes on Escape, unless the cancel is running", async () => {
      renderPanel(order({ status: "paid" }));
      const { dialog } = await openCancel();

      fireEvent(dialog, new Event("cancel", { cancelable: true }));

      expect(dialog).not.toHaveAttribute("open");
    });

    it("cancels, closes the dialog and says so", async () => {
      server.use(
        orderActionHandler("cancel", () =>
          orderResponse(
            order({ status: "cancelled", cancel_reason: "seller_cancelled" }),
          ),
        ),
      );
      renderPanel(order({ status: "paid" }));
      const { userEvents, dialog } = await openCancel();

      await userEvents.click(
        within(dialog).getByRole("button", { name: "Batalkan pesanan" }),
      );

      expect(await within(panel()).findByRole("status")).toHaveTextContent(
        `Pesanan ${order().code} dibatalkan. Stok dan voucher sudah dikembalikan.`,
      );
      expect(dialog).not.toHaveAttribute("open");
      expect(
        within(badge()).getByText("Dibatalkan (dibatalkan toko)"),
      ).toBeInTheDocument();
    });

    it("keeps the dialog open with the message after a failure retrying can fix", async () => {
      server.use(
        orderActionHandler("cancel", () =>
          errorResponse(500, "INTERNAL_ERROR"),
        ),
      );
      renderPanel(order({ status: "paid" }));
      const { userEvents, dialog } = await openCancel();

      await userEvents.click(
        within(dialog).getByRole("button", { name: "Batalkan pesanan" }),
      );

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Pesanan belum berubah karena kesalahan di server. Coba lagi.",
      );
      expect(dialog).toHaveAttribute("open");
      expect(within(panel()).queryByRole("alert", { hidden: false })).toBe(
        within(dialog).getByRole("alert"),
      );
    });

    it("ignores Escape while the cancel runs", async () => {
      const answer = deferred<Response>();
      server.use(orderActionHandler("cancel", () => answer.promise));
      renderPanel(order({ status: "paid" }));
      const { userEvents, dialog } = await openCancel();

      await userEvents.click(
        within(dialog).getByRole("button", { name: "Batalkan pesanan" }),
      );
      await within(dialog).findByRole("button", { name: "Memproses…" });
      fireEvent(dialog, new Event("cancel", { cancelable: true }));

      expect(dialog).toHaveAttribute("open");
      answer.resolve(orderResponse(order({ status: "cancelled" })));
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute("open");
      });
    });

    it("closes the dialog on a 404 and says the order is gone, focused", async () => {
      server.use(
        orderActionHandler("cancel", () => errorResponse(404, "NOT_FOUND")),
      );
      renderPanel(order({ status: "paid" }));
      const { userEvents, dialog } = await openCancel();

      await userEvents.click(
        within(dialog).getByRole("button", { name: "Batalkan pesanan" }),
      );

      await waitFor(() => {
        expect(dialog).not.toHaveAttribute("open");
      });
      const alert = within(panel()).getByRole("alert");
      expect(alert).toHaveTextContent("Pesanan ini tidak ditemukan lagi.");
      await waitFor(() => {
        expect(alert).toHaveFocus();
      });
    });

    it("on a 403, refreshes the session: the new role hides cancel, and the alert says only an admin may", async () => {
      const sent = recordRequests();
      server.use(
        orderActionHandler("cancel", () => errorResponse(403, "FORBIDDEN")),
        webRefreshHandler(() =>
          sessionResponse(webSession("token-2", user({ role: "seller" }))),
        ),
      );
      renderPanel(order({ status: "paid" }));
      const { userEvents, dialog } = await openCancel();

      await userEvents.click(
        within(dialog).getByRole("button", { name: "Batalkan pesanan" }),
      );

      const alert = await within(panel()).findByRole("alert");
      expect(alert).toHaveTextContent(
        "Hanya admin yang boleh membatalkan pesanan. Minta admin toko untuk membatalkannya.",
      );
      expect(dialog).not.toHaveAttribute("open");
      expect(
        within(panel()).queryByRole("button", { name: "Batalkan pesanan" }),
      ).toBeNull();
      expect(panel()).toHaveTextContent(
        "Pembatalan pesanan dilakukan oleh admin toko.",
      );
      expect(sent.map((r) => r.url.pathname)).toContain("/v1/auth/web/refresh");
    });
  });

  describe("Tandai selesai", () => {
    it("asks first, then completes the order", async () => {
      const sent = recordRequests();
      server.use(
        orderActionHandler("complete", () =>
          orderResponse(order({ status: "completed" })),
        ),
      );
      const userEvents = userEvent.setup();
      renderPanel(order({ status: "shipped" }), { role: "seller" });
      await loaded();

      await userEvents.click(
        screen.getByRole("button", { name: "Tandai selesai" }),
      );
      const dialog = screen.getByRole("alertdialog", {
        name: `Tandai pesanan ${order().code} selesai?`,
      });
      expect(
        within(dialog).getByRole("button", { name: "Batal" }),
      ).toHaveFocus();
      await userEvents.click(
        within(dialog).getByRole("button", { name: "Tandai selesai" }),
      );

      expect(await within(panel()).findByRole("status")).toHaveTextContent(
        `Pesanan ${order().code} selesai.`,
      );
      expect(sent.find((r) => r.method === "POST")?.url.pathname).toBe(
        `/v1/admin/orders/${ORDER_ID}/complete`,
      );
    });

    it("closes from Batal without completing", async () => {
      const userEvents = userEvent.setup();
      renderPanel(order({ status: "shipped" }));
      await loaded();

      await userEvents.click(
        screen.getByRole("button", { name: "Tandai selesai" }),
      );
      const dialog = screen.getByRole("alertdialog");
      await userEvents.click(
        within(dialog).getByRole("button", { name: "Batal" }),
      );

      expect(dialog).not.toHaveAttribute("open");
    });
  });

  describe("Tandai dikirim (ShipOrderForm)", () => {
    const processing = () => order({ status: "processing" });

    it("names the buyer's courier and checks the resi before sending", async () => {
      const sent = recordRequests();
      const userEvents = userEvent.setup();
      renderPanel(processing());
      await loaded();
      const form = screen.getByRole("form", { name: "Kirim pesanan" });
      const field = within(form).getByLabelText("Nomor resi");

      expect(form).toHaveTextContent("Kurir pilihan pembeli: JNE REG.");
      await userEvents.click(
        within(form).getByRole("button", { name: "Tandai dikirim" }),
      );
      expect(field).toHaveAccessibleDescription(
        /Huruf, angka dan tanda hubung.*Masukkan nomor resi dari kurir\./,
      );
      await userEvents.type(field, "JNE 01");
      await userEvents.click(
        within(form).getByRole("button", { name: "Tandai dikirim" }),
      );
      expect(field).toHaveAccessibleDescription(/tanpa spasi/);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(sent.filter((r) => r.method === "POST")).toEqual([]);
    });

    it("sends the resi trimmed and upper-cased, then says the order shipped", async () => {
      const sent = recordRequests();
      server.use(
        orderActionHandler("ship", () =>
          orderResponse(
            order({
              status: "shipped",
              shipping: {
                ...order().shipping,
                tracking_number: "JNE0123456789",
              },
            }),
          ),
        ),
      );
      const userEvents = userEvent.setup();
      renderPanel(processing());
      await loaded();

      await userEvents.type(
        screen.getByLabelText("Nomor resi"),
        " jne0123456789 ",
      );
      await userEvents.click(
        screen.getByRole("button", { name: "Tandai dikirim" }),
      );

      expect(await within(panel()).findByRole("status")).toHaveTextContent(
        `Pesanan ${order().code} ditandai dikirim.`,
      );
      const post = sent.find((r) => r.method === "POST");
      expect(post?.url.pathname).toBe(`/v1/admin/orders/${ORDER_ID}/ship`);
      expect(await post?.json()).toEqual({ tracking_number: "JNE0123456789" });
      expect(screen.queryByRole("form", { name: "Kirim pesanan" })).toBeNull();
    });

    it("puts the API's field message on the field, not in the panel", async () => {
      server.use(
        orderActionHandler("ship", () =>
          errorResponse(400, "VALIDATION_FAILED", {
            details: { tracking_number: "must be at least 6 characters" },
          }),
        ),
      );
      const userEvents = userEvent.setup();
      renderPanel(processing());
      await loaded();

      await userEvents.type(
        screen.getByLabelText("Nomor resi"),
        "JNE0123456789",
      );
      await userEvents.click(
        screen.getByRole("button", { name: "Tandai dikirim" }),
      );

      await waitFor(() => {
        expect(screen.getByLabelText("Nomor resi")).toHaveAccessibleDescription(
          /Minimal 6 karakter\./,
        );
      });
      expect(within(panel()).queryByRole("alert")).toBeNull();
    });

    it("shows any other ship failure in the panel", async () => {
      server.use(
        orderActionHandler("ship", () =>
          errorResponse(409, "INVALID_TRANSITION", {
            details: { status: "cancelled" },
          }),
        ),
      );
      const userEvents = userEvent.setup();
      renderPanel(processing(), { after: order({ status: "cancelled" }) });
      await loaded();

      await userEvents.type(
        screen.getByLabelText("Nomor resi"),
        "JNE0123456789",
      );
      await userEvents.click(
        screen.getByRole("button", { name: "Tandai dikirim" }),
      );

      expect(await within(panel()).findByRole("alert")).toHaveTextContent(
        "statusnya sekarang “Dibatalkan”",
      );
    });

    it("says 'Memproses…' while the resi is sent", async () => {
      const answer = deferred<Response>();
      server.use(orderActionHandler("ship", () => answer.promise));
      const userEvents = userEvent.setup();
      renderPanel(processing());
      await loaded();

      await userEvents.type(
        screen.getByLabelText("Nomor resi"),
        "JNE0123456789",
      );
      await userEvents.click(
        screen.getByRole("button", { name: "Tandai dikirim" }),
      );

      expect(
        await screen.findByRole("button", { name: "Memproses…" }),
      ).toBeDisabled();
      answer.resolve(orderResponse(order({ status: "shipped" })));
      expect(await within(panel()).findByRole("status")).toHaveTextContent(
        "ditandai dikirim",
      );
    });
  });
});
