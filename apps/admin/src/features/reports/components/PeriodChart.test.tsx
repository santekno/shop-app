import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { SalesReport } from "@goshop/shared";
import { period, salesReport } from "@/test/fixtures.ts";
import { stubSizedResizeObserver } from "@/test/resize-observer.ts";
import { plain } from "@/test/text.ts";
import { toChartRows } from "../chart-rows.ts";
import { PeriodChart } from "./PeriodChart.tsx";
import type { ChartMeasure } from "./PeriodChart.tsx";

beforeEach(() => {
  stubSizedResizeObserver();
});

const renderChart = (
  measure: ChartMeasure,
  report: SalesReport = salesReport(),
) =>
  render(
    <>
      <p id="catatan">Ringkasan grafik.</p>
      <PeriodChart
        report={report}
        rows={toChartRows(report)}
        measure={measure}
        label="Pendapatan per hari, 28–30 Okt 2026"
        describedBy="catatan"
      />
    </>,
  );

const chart = () =>
  screen.getByRole("img", { name: "Pendapatan per hari, 28–30 Okt 2026" });
const texts = () =>
  Array.from(chart().querySelectorAll("text")).map((node) =>
    plain(node.textContent),
  );

describe("PeriodChart", () => {
  it("is one image to a screen reader, named and described", async () => {
    renderChart("revenue");

    await waitFor(() => {
      expect(chart().tagName.toLowerCase()).toBe("svg");
    });
    expect(chart()).toHaveAccessibleDescription("Ringkasan grafik.");
    expect(chart()).toHaveAttribute("viewBox", "0 0 640 256");
  });

  it("labels the axis with short dates and compact rupiah", async () => {
    renderChart("revenue");

    await waitFor(() => {
      expect(texts()).toContain("28 Okt");
    });
    expect(texts()).toContain("30 Okt");
    expect(texts().some((text) => /^Rp\d/.test(text))).toBe(true);
    expect(texts()).toContain("Rp0");
  });

  it("labels the orders axis with plain counts", async () => {
    renderChart("orders");

    await waitFor(() => {
      expect(texts()).toContain("28 Okt");
    });
    expect(texts().some((text) => text.startsWith("Rp"))).toBe(false);
    expect(texts()).toContain("3");
  });

  it("labels a month by its name", async () => {
    renderChart(
      "cumulative",
      salesReport({
        from: "2026-09-01",
        to: "2026-10-31",
        group: "month",
        series: [
          period("2026-09-01", 2, 200_000),
          period("2026-10-01", 3, 500_000),
        ],
      }),
    );

    await waitFor(() => {
      expect(texts()).toContain("Okt 2026");
    });
    expect(texts()).toContain("Sep 2026");
  });

  it("shows every number of a period in the tooltip, from the keyboard", async () => {
    const user = userEvent.setup();
    renderChart("revenue");
    await waitFor(() => {
      expect(texts()).toContain("28 Okt");
    });

    chart().focus();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");

    const label = await screen.findByText("Jumat, 30 Oktober 2026");
    const tooltip = label.parentElement;
    expect(plain(tooltip?.textContent)).toBe(
      "Jumat, 30 Oktober 2026PendapatanRp 300.000Pesanan3Rata-rataRp 100.000KumulatifRp 500.000",
    );
  });
});
