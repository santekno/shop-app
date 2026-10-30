import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SalesReport } from "@goshop/shared";
import { period, salesReport } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { salesReportHandler, salesReportResponse } from "@/test/msw/reports.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { stubSizedResizeObserver } from "@/test/resize-observer.ts";
import { plain } from "@/test/text.ts";
import { addDays, jakartaToday } from "../report-params.ts";
import { chartSummary } from "../report-summary.ts";
import { ReportsPage } from "./ReportsPage.tsx";

// chartSummary runs on every render of the report's body (both charts'
// notes): counting its calls counts those renders (artikel 14's memo).
vi.mock("../report-summary.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../report-summary.ts")>();
  return { ...actual, chartSummary: vi.fn(actual.chartSummary) };
});

const renderPage = (
  url = "/laporan",
  report:
    SalesReport | Parameters<typeof salesReportHandler>[0] = salesReport(),
) => {
  server.use(salesReportHandler(report));
  return renderRoute(<ReportsPage />, { path: "/laporan", url });
};

const loaded = () =>
  screen.findByText(
    /per hari\. Tanggal menurut WIB\.|per minggu\.|per bulan\./,
  );
const query = (request: { url: URL }) =>
  Object.fromEntries(request.url.searchParams);

describe("ReportsPage", () => {
  it("asks for the last 30 days per day by default, as two dates", async () => {
    const sent = recordRequests();
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Memuat laporan…");
    await loaded();
    const today = jakartaToday();
    expect(query(sent[0] as { url: URL })).toEqual({
      from: addDays(today, -29),
      to: today,
      group: "day",
    });
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "28–30 Okt 2026, per hari. Tanggal menurut WIB.",
    );
    expect(document.title).toBe("Laporan — GoShop Admin");
    expect(screen.getByRole("radio", { name: "30 hari" })).toBeChecked();
  });

  it("shows the totals as named tiles", async () => {
    renderPage();
    await loaded();

    const names = screen
      .getAllByRole("term")
      .slice(0, 3)
      .map((dt) => dt.textContent);
    const values = screen
      .getAllByRole("definition")
      .slice(0, 3)
      .map((dd) => plain(dd.textContent));
    expect(names).toEqual(["Pendapatan", "Pesanan", "Rata-rata per pesanan"]);
    expect(values).toEqual(["Rp 500.000", "5", "Rp 100.000"]);
  });

  it("titles both charts by the grouping and summarises each", async () => {
    renderPage();
    await loaded();

    const revenue = screen.getByRole("region", { name: "Pendapatan per hari" });
    expect(plain(revenue.textContent)).toContain(
      "Tertinggi Rp 300.000 pada Jumat, 30 Oktober 2026. 1 dari 3 hari tanpa penjualan.",
    );
    const orders = screen.getByRole("region", { name: "Pesanan per hari" });
    expect(plain(orders.textContent)).toContain(
      "Terbanyak 3 pesanan pada Jumat, 30 Oktober 2026.",
    );
  });

  it("switches the revenue chart to the running total and back", async () => {
    // Sized charts, so the axis is drawn: the running total reaches
    // Rp 500.000 (an axis up to Rp600 rb), the best day only Rp 300.000.
    stubSizedResizeObserver();
    const axis = (name: string) =>
      Array.from(
        screen
          .getByRole("img", { name: new RegExp(`^${name}`) })
          .querySelectorAll("text"),
      ).map((node) => plain(node.textContent));
    const userEvents = userEvent.setup();
    renderPage();
    await loaded();
    await waitFor(() => {
      expect(axis("Pendapatan per hari")).toContain("Rp300 rb");
    });
    expect(axis("Pendapatan per hari")).not.toContain("Rp600 rb");
    const toggle = screen.getByRole("checkbox", {
      name: "Tampilkan kumulatif",
    });

    await userEvents.click(toggle);

    const revenue = screen.getByRole("region", {
      name: "Pendapatan kumulatif",
    });
    expect(revenue).toHaveTextContent(
      "Jumlah pendapatan dari awal rentang sampai tiap periode.",
    );
    await waitFor(() => {
      expect(axis("Pendapatan kumulatif")).toContain("Rp600 rb");
    });
    await userEvents.click(toggle);
    expect(
      screen.getByRole("region", { name: "Pendapatan per hari" }),
    ).toBeInTheDocument();
  });

  it("puts every number in a table behind a disclosure, with the total row", async () => {
    const userEvents = userEvent.setup();
    renderPage();
    await loaded();

    await userEvents.click(screen.getByText("Lihat data dalam tabel (3 hari)"));
    const table = screen.getByRole("region", {
      name: "Data penjualan per hari",
    });

    const rows = within(table)
      .getAllByRole("row")
      .map((row) => plain(row.textContent));
    expect(rows).toEqual([
      "PeriodePendapatanPesananRata-rata per pesananKumulatif",
      "Rabu, 28 Oktober 2026Rp 200.0002Rp 100.000Rp 200.000",
      "Kamis, 29 Oktober 2026Rp 00Rp 0Rp 200.000",
      "Jumat, 30 Oktober 2026Rp 300.0003Rp 100.000Rp 500.000",
      "TotalRp 500.0005Rp 100.000Rp 500.000",
    ]);
    expect(
      within(table).getByRole("rowheader", { name: "Kamis, 29 Oktober 2026" }),
    ).toBeInTheDocument();
  });

  it("lists the best sellers, each linking to its product", async () => {
    renderPage();
    await loaded();

    // The card and the table inside it are both named "Produk terlaris".
    const [top] = screen.getAllByRole("region", { name: "Produk terlaris" });
    if (top === undefined) throw new Error("no top products");
    const [, row] = within(top).getAllByRole("row");
    if (row === undefined) throw new Error("no product row");
    expect(plain(row.textContent)).toBe("1Kaos Polos4 unitRp 356.000");
    expect(
      within(row).getByRole("link", { name: "Kaos Polos" }),
    ).toHaveAttribute("href", "/produk/p-1");
  });

  it("says no product was sold when the top list is empty", async () => {
    renderPage("/laporan", salesReport({ top_products: [] }));
    await loaded();

    expect(
      screen.getByRole("region", { name: "Produk terlaris" }),
    ).toHaveTextContent("Belum ada produk terjual pada rentang ini.");
    expect(screen.queryByRole("table", { name: "Produk terlaris" })).toBeNull();
  });

  it("says there were no sales instead of empty charts", async () => {
    renderPage(
      "/laporan",
      salesReport({
        series: [period("2026-10-28", 0), period("2026-10-30", 0)],
      }),
    );
    await loaded();

    expect(
      plain(screen.getByText(/Belum ada penjualan pada/).textContent),
    ).toBe(
      "Belum ada penjualan pada 28–30 Okt 2026. Pilih rentang lain, atau tunggu pesanan pertama dibayar.",
    );
    expect(
      screen.queryByRole("region", { name: "Pendapatan per hari" }),
    ).toBeNull();
  });

  it("explains a failure and loads again from Coba lagi", async () => {
    let calls = 0;
    const userEvents = userEvent.setup();
    renderPage("/laporan", () => {
      calls += 1;
      return calls === 1
        ? errorResponse(403, "FORBIDDEN")
        : salesReportResponse(salesReport());
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Peran akun Anda tidak boleh membuka data ini.",
    );
    await userEvents.click(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    );

    expect(await loaded()).toBeInTheDocument();
  });

  describe("the controls", () => {
    it("does not render the report again while the next one loads with the old one on screen", async () => {
      const next = deferred<Response>();
      let calls = 0;
      const userEvents = userEvent.setup();
      renderPage("/laporan", () => {
        calls += 1;
        return calls === 1 ? salesReportResponse(salesReport()) : next.promise;
      });
      await loaded();
      const rendersBefore = vi.mocked(chartSummary).mock.calls.length;
      expect(rendersBefore).toBeGreaterThan(0);

      await userEvents.click(screen.getByRole("radio", { name: "7 hari" }));
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent("Memuat laporan…");
      });
      expect(vi.mocked(chartSummary).mock.calls).toHaveLength(rendersBefore);

      next.resolve(
        salesReportResponse(salesReport({ series: [period("2026-10-30", 1)] })),
      );
      await waitFor(() => {
        expect(vi.mocked(chartSummary).mock.calls.length).toBeGreaterThan(
          rendersBefore,
        );
      });
      expect(
        plain(
          screen.getByRole("region", { name: "Pesanan per hari" }).textContent,
        ),
      ).toContain("Terbanyak 1 pesanan");
    });

    it("asks for 7 days from the preset, in the URL, and keeps the old report dimmed meanwhile", async () => {
      const sent = recordRequests();
      const next = deferred<Response>();
      let calls = 0;
      const userEvents = userEvent.setup();
      const { router } = renderPage("/laporan", () => {
        calls += 1;
        return calls === 1 ? salesReportResponse(salesReport()) : next.promise;
      });
      await loaded();

      await userEvents.click(screen.getByRole("radio", { name: "7 hari" }));

      expect(screen.getByRole("radio", { name: "7 hari" })).toBeChecked();
      expect(router.state.location.search).toBe("?rentang=7");
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent("Memuat laporan…");
      });
      expect(
        screen.getByRole("region", { name: "Pendapatan per hari" })
          .parentElement,
      ).toHaveAttribute("aria-busy", "true");
      const today = jakartaToday();
      expect(query(sent[1] as { url: URL })).toEqual({
        from: addDays(today, -6),
        to: today,
        group: "day",
      });

      next.resolve(
        salesReportResponse(salesReport({ series: [period("2026-10-30", 1)] })),
      );
      await waitFor(() => {
        expect(screen.getByRole("status")).not.toHaveTextContent("Memuat");
      });
    });

    it("regroups from the select", async () => {
      const sent = recordRequests();
      const userEvents = userEvent.setup();
      const { router } = renderPage("/laporan?rentang=90", (request) =>
        salesReportResponse(
          salesReport({
            group: (new URL(request.url).searchParams.get("group") ??
              "day") as "day",
          }),
        ),
      );
      await loaded();

      await userEvents.selectOptions(
        screen.getByLabelText("Kelompokkan"),
        "Per minggu",
      );

      expect(router.state.location.search).toBe("?rentang=90&kelompok=minggu");
      await screen.findByText(/per minggu\./);
      expect(sent.at(-1)?.url.searchParams.get("group")).toBe("week");
      expect(screen.getByLabelText("Kelompokkan")).toHaveValue("week");
    });

    it("opens the date form with the range on screen, applying nothing yet", async () => {
      const sent = recordRequests();
      const userEvents = userEvent.setup();
      const { router } = renderPage("/laporan?rentang=7");
      await loaded();

      await userEvents.click(
        screen.getByRole("radio", { name: "Pilih tanggal" }),
      );

      const form = screen.getByRole("form", { name: "Rentang tanggal" });
      const today = jakartaToday();
      expect(within(form).getByLabelText("Dari")).toHaveValue(
        addDays(today, -6),
      );
      expect(within(form).getByLabelText("Sampai")).toHaveValue(today);
      expect(
        screen.getByRole("radio", { name: "Pilih tanggal" }),
      ).toBeChecked();
      expect(router.state.location.search).toBe("?rentang=7");
      expect(sent).toHaveLength(1);
    });

    it("checks the dates on Terapkan, focusing the field to fix, and re-checks as it changes", async () => {
      const userEvents = userEvent.setup();
      renderPage("/laporan?dari=2026-10-01&sampai=2026-10-31");
      await loaded();
      const form = screen.getByRole("form", { name: "Rentang tanggal" });
      const from = within(form).getByLabelText("Dari");
      const to = within(form).getByLabelText("Sampai");

      await userEvents.clear(to);
      await userEvents.type(to, "2026-09-30");
      expect(to).not.toHaveAttribute("aria-invalid");
      await userEvents.click(
        within(form).getByRole("button", { name: "Terapkan" }),
      );

      expect(to).toHaveAccessibleDescription(
        "Tanggal akhir tidak boleh sebelum tanggal mulai.",
      );
      expect(to).toHaveFocus();
      expect(from).not.toHaveAttribute("aria-invalid");

      await userEvents.clear(to);
      await userEvents.type(to, "2026-10-15");
      expect(to).not.toHaveAttribute("aria-invalid");
    });

    it("focuses Dari first when both dates are missing", async () => {
      const userEvents = userEvent.setup();
      renderPage("/laporan?dari=2026-10-01&sampai=2026-10-31");
      await loaded();
      const form = screen.getByRole("form", { name: "Rentang tanggal" });

      await userEvents.clear(within(form).getByLabelText("Dari"));
      await userEvents.clear(within(form).getByLabelText("Sampai"));
      await userEvents.click(
        within(form).getByRole("button", { name: "Terapkan" }),
      );

      expect(within(form).getByLabelText("Dari")).toHaveAccessibleDescription(
        "Pilih tanggal mulai.",
      );
      expect(within(form).getByLabelText("Sampai")).toHaveAccessibleDescription(
        "Pilih tanggal akhir.",
      );
      expect(within(form).getByLabelText("Dari")).toHaveFocus();
    });

    it("applies two valid dates to the URL and the request", async () => {
      const sent = recordRequests();
      const userEvents = userEvent.setup();
      const { router } = renderPage("/laporan");
      await loaded();

      await userEvents.click(
        screen.getByRole("radio", { name: "Pilih tanggal" }),
      );
      const form = screen.getByRole("form", { name: "Rentang tanggal" });
      await userEvents.clear(within(form).getByLabelText("Dari"));
      await userEvents.type(within(form).getByLabelText("Dari"), "2026-10-01");
      await userEvents.clear(within(form).getByLabelText("Sampai"));
      await userEvents.type(
        within(form).getByLabelText("Sampai"),
        "2026-10-31",
      );
      await userEvents.click(
        within(form).getByRole("button", { name: "Terapkan" }),
      );

      expect(router.state.location.search).toBe(
        "?dari=2026-10-01&sampai=2026-10-31",
      );
      await waitFor(() => {
        expect(query(sent.at(-1) as { url: URL })).toEqual({
          from: "2026-10-01",
          to: "2026-10-31",
          group: "day",
        });
      });
    });

    it("closes an unapplied date form when a preset is chosen", async () => {
      const userEvents = userEvent.setup();
      renderPage("/laporan");
      await loaded();

      await userEvents.click(
        screen.getByRole("radio", { name: "Pilih tanggal" }),
      );
      await userEvents.click(screen.getByRole("radio", { name: "90 hari" }));

      expect(
        screen.queryByRole("form", { name: "Rentang tanggal" }),
      ).toBeNull();
      expect(screen.getByRole("radio", { name: "90 hari" })).toBeChecked();
    });

    it("closes an unapplied date form when the URL changes under it", async () => {
      const userEvents = userEvent.setup();
      const { router } = renderPage("/laporan");
      await loaded();

      await userEvents.click(
        screen.getByRole("radio", { name: "Pilih tanggal" }),
      );
      expect(
        screen.getByRole("form", { name: "Rentang tanggal" }),
      ).toBeInTheDocument();
      await act(() => router.navigate("/laporan?kelompok=minggu"));

      expect(
        screen.queryByRole("form", { name: "Rentang tanggal" }),
      ).toBeNull();
      expect(screen.getByRole("radio", { name: "30 hari" })).toBeChecked();
    });

    it("follows Back to the previous range", async () => {
      const userEvents = userEvent.setup();
      const { router } = renderPage("/laporan");
      await loaded();

      await userEvents.click(screen.getByRole("radio", { name: "7 hari" }));
      await waitFor(() => {
        expect(router.state.location.search).toBe("?rentang=7");
      });
      await router.navigate(-1);

      await waitFor(() => {
        expect(screen.getByRole("radio", { name: "30 hari" })).toBeChecked();
      });
    });
  });
});
