import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { addDays, jakartaToday } from "@/features/reports/report-params.ts";
import { salesReport, session } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { salesReportHandler, salesReportResponse } from "@/test/msw/reports.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { OverviewPage } from "./OverviewPage.tsx";

const renderPage = (
  answer: Parameters<typeof salesReportHandler>[0] = salesReport(),
) => {
  server.use(salesReportHandler(answer));
  return renderRoute(<OverviewPage />, {
    session: session("seller", "t", { name: "Sari" }),
  });
};

const tile = () =>
  screen.getByRole("region", { name: "Penjualan 7 hari terakhir" });

describe("OverviewPage", () => {
  it("greets the user by name and role", async () => {
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Ringkasan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Halo, Sari. Anda masuk sebagai Penjual."),
    ).toBeInTheDocument();
    expect(document.title).toBe("Ringkasan — GoShop Admin");
    await within(tile()).findByText(/pesanan/);
  });

  it("has a card per section of the menu, not one for itself", async () => {
    renderPage();
    await within(tile()).findByText(/pesanan/);

    const cards = screen.getAllByRole("heading", { level: 2 }).slice(1);
    expect(cards.map((heading) => heading.textContent)).toEqual([
      "Produk",
      "Pesanan",
      "Laporan",
    ]);
    expect(screen.getByRole("link", { name: "Pesanan" })).toHaveAttribute(
      "href",
      "/pesanan",
    );
    expect(
      screen.getByText("Proses, kirim dan selesaikan pesanan pembeli."),
    ).toBeInTheDocument();
  });
});

describe("RecentSalesTile", () => {
  it("asks for exactly the report /laporan?rentang=7&kelompok=minggu shows", async () => {
    const sent = recordRequests();
    renderPage();

    await within(tile()).findByText(/pesanan/);
    const today = jakartaToday();
    expect(Object.fromEntries(sent[0]?.url.searchParams ?? [])).toEqual({
      from: addDays(today, -6),
      to: today,
      group: "week",
    });
  });

  it("says it is loading, then shows the revenue, the orders and the link", async () => {
    const answer = deferred<Response>();
    renderPage(() => answer.promise);

    expect(within(tile()).getByRole("status")).toHaveTextContent(
      "Memuat penjualan…",
    );
    answer.resolve(salesReportResponse(salesReport()));

    expect(
      await within(tile()).findByText("Rp 500.000", { normalizer: plain }),
    ).toBeInTheDocument();
    expect(plain(tile().textContent)).toContain(
      "5 pesanan, 28–30 Okt 2026 (WIB).",
    );
    expect(
      within(tile()).getByRole("link", { name: "Lihat laporan" }),
    ).toHaveAttribute("href", "/laporan?rentang=7&kelompok=minggu");
  });

  it("says the sales could not be loaded, with a link to the report", async () => {
    renderPage(() => errorResponse(500, "INTERNAL_ERROR"));

    expect(
      await within(tile()).findByText(
        /Penjualan tidak dapat dimuat sekarang\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(tile()).getByRole("link", { name: "Buka laporan" }),
    ).toHaveAttribute("href", "/laporan?rentang=7");
  });
});
