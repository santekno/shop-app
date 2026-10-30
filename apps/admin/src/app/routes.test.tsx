import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ORDER_ID, order, salesReport, session } from "@/test/fixtures.ts";
import { quietEventsHandler } from "@/test/msw/events.ts";
import { orderDetailHandler } from "@/test/msw/orders.ts";
import { salesReportHandler } from "@/test/msw/reports.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoutes } from "@/test/render.tsx";
import type { TestSession } from "@/test/render.tsx";
import { routes } from "./routes.tsx";

// A lazy route's first visit imports its chunk (Recharts for /laporan),
// which under coverage instrumentation takes longer than findBy's 1 s.
const LAZY = { timeout: 5_000 };

const renderApp = (url: string, who: TestSession = session()) => {
  server.use(
    quietEventsHandler(),
    salesReportHandler(salesReport()),
    orderDetailHandler(order()),
  );
  return renderRoutes(routes, { url, session: who });
};

describe("routes", () => {
  it("opens the overview inside the dashboard at /", async () => {
    renderApp("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Ringkasan" }, LAZY),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Menu utama" }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", { name: "Jejak navigasi" }),
      ).getByText("Ringkasan"),
    ).toHaveAttribute("aria-current", "page");
  });

  it("loads the login page's code for /masuk", async () => {
    renderApp("/masuk", null);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Masuk" }, LAZY),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
  });

  it("sends a visitor without a session to /masuk, remembering the page", async () => {
    const { router } = renderApp("/pesanan?status=dikirim", null);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Masuk" }, LAZY),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/masuk");
    expect(router.state.location.search).toBe(
      `?kembali=${encodeURIComponent("/pesanan?status=dikirim")}`,
    );
  });

  it("loads the order detail page under Pesanan", async () => {
    renderApp(`/pesanan/${ORDER_ID}`);

    expect(
      await screen.findByRole(
        "heading",
        { level: 1, name: "Detail pesanan" },
        LAZY,
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", { name: "Jejak navigasi" }),
      ).getByRole("link", {
        name: "Pesanan",
      }),
    ).toHaveAttribute("href", "/pesanan");
  });

  it("shows the shipping label without the dashboard around it", async () => {
    renderApp(`/pesanan/${ORDER_ID}/resi`);

    expect(
      await screen.findByRole(
        "heading",
        { level: 1, name: `Resi pengiriman ${order().code}` },
        LAZY,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
  });

  it("loads the report page for /laporan", async () => {
    renderApp("/laporan");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Laporan" }, LAZY),
    ).toBeInTheDocument();
  });

  it("says a dashboard URL no route knows was not found, keeping the menu", async () => {
    renderApp("/tidak-ada");

    expect(
      await screen.findByRole(
        "heading",
        { level: 1, name: "Halaman tidak ditemukan" },
        LAZY,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Menu utama" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Kembali ke ringkasan" }),
    ).toHaveAttribute("href", "/");
    expect(document.title).toBe("Halaman tidak ditemukan — GoShop Admin");
  });

  it("shows a buyer the no-access page at any dashboard URL", async () => {
    renderApp("/laporan", session("buyer"));

    expect(
      await screen.findByRole(
        "heading",
        { level: 1, name: "Tidak ada akses" },
        LAZY,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
  });
});
