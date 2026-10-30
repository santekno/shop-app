import type { AdminOrderEvent } from "@goshop/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { session } from "@/test/fixtures.ts";
import {
  eventStreamResponse,
  eventsHandler,
  openStream,
  orderEventFrame,
} from "@/test/msw/events.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoutes } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { OrderEventsProvider } from "./OrderEventsProvider.tsx";
import { OrderToasts } from "./OrderToasts.tsx";
import { UnreadOrdersBadge } from "./UnreadOrdersBadge.tsx";

const paid = (code: string): AdminOrderEvent => ({
  type: "order.paid",
  order_id: `o-${code}`,
  code,
  status: "paid",
  total: { amount: 117_000, currency: "IDR" },
  occurred_at: "2026-10-30T03:00:00Z",
});

/** The provider with what the layout puts under it, at `url`. */
const renderProvider = (url = "/") => {
  const streams: ReturnType<typeof openStream>[] = [];
  server.use(
    eventsHandler(() => {
      const stream = openStream();
      stream.push(": connected\n\n");
      streams.push(stream);
      return eventStreamResponse(stream.body);
    }),
  );
  const view = renderRoutes(
    [
      {
        element: (
          <OrderEventsProvider>
            <ConnectionStatus />
            <nav aria-label="Menu utama">
              <Link to="/pesanan">
                Pesanan
                <UnreadOrdersBadge />
              </Link>
              <Link to="/produk">Produk</Link>
            </nav>
            <Outlet />
            <OrderToasts />
          </OrderEventsProvider>
        ),
        children: [
          { path: "/", element: <h1>Ringkasan</h1> },
          { path: "/produk", element: <h1>Produk</h1> },
          { path: "/pesanan", element: <h1>Pesanan</h1> },
          { path: "/pesanan/:id", element: <h1>Detail</h1> },
        ],
      },
    ],
    { url, session: session() },
  );
  const send = async (frame: string) => {
    await waitFor(() => {
      expect(streams).toHaveLength(1);
    });
    streams[0]?.push(frame);
  };
  return { ...view, send };
};

const ordersLink = () =>
  within(screen.getByRole("navigation", { name: "Menu utama" })).getByRole(
    "link",
    {
      name: /^Pesanan/,
    },
  );

describe("OrderEventsProvider", () => {
  it("shows the connection's status in the header", async () => {
    renderProvider();

    expect(await screen.findByText("Langsung")).toBeInTheDocument();
  });

  it("turns a paid order into a toast and an unread count", async () => {
    const { send } = renderProvider("/");

    await send(orderEventFrame("e-1", paid("GS-1")));

    const toasts = await screen.findByRole("region", {
      name: "Notifikasi pesanan",
    });
    expect(plain(toasts.textContent)).toContain(
      "Pesanan baru GS-1 · Rp 117.000",
    );
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Pesanan baru GS-1 · Rp 117.000",
    );
    expect(ordersLink()).toHaveTextContent(/1\s*pesanan baru/);
  });

  it("counts each paid order once, and none of the other events", async () => {
    const { send } = renderProvider("/");

    await send(
      orderEventFrame("e-1", paid("GS-1")) +
        orderEventFrame("e-1", paid("GS-1")) +
        orderEventFrame("e-2", {
          ...paid("GS-2"),
          type: "order.created",
          status: "pending_payment",
        }) +
        orderEventFrame("e-3", {
          ...paid("GS-3"),
          type: "order.shipped",
          status: "shipped",
        }) +
        orderEventFrame("e-4", paid("GS-4")),
    );

    await waitFor(() => {
      expect(ordersLink()).toHaveTextContent(/2\s*pesanan baru/);
    });
    const toasts = screen.getByRole("region", { name: "Notifikasi pesanan" });
    expect(within(toasts).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the toast but counts nothing while the orders page is open", async () => {
    const { send } = renderProvider("/pesanan/o-1");

    await send(orderEventFrame("e-1", paid("GS-1")));

    expect(
      await screen.findByRole("region", { name: "Notifikasi pesanan" }),
    ).toBeInTheDocument();
    expect(ordersLink()).toHaveAccessibleName("Pesanan");
  });

  it("clears the count when the orders page opens, and counts again after leaving it", async () => {
    const userEvents = userEvent.setup();
    const { send } = renderProvider("/");
    await send(orderEventFrame("e-1", paid("GS-1")));
    await waitFor(() => {
      expect(ordersLink()).toHaveTextContent(/1\s*pesanan baru/);
    });

    await userEvents.click(ordersLink());
    expect(ordersLink()).toHaveAccessibleName("Pesanan");

    await userEvents.click(screen.getByRole("link", { name: "Produk" }));
    await send(orderEventFrame("e-2", paid("GS-2")));
    await waitFor(() => {
      expect(ordersLink()).toHaveTextContent(/1\s*pesanan baru/);
    });
  });
});
