import { describe, expect, it, vi } from "vitest";
import { getSalesReport } from "./admin-reports.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { SalesReport } from "./types.ts";

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries: 0,
  });
  const url = () => {
    const [input] = fetchMock.mock.calls[0] ?? [];
    return new URL(typeof input === "string" ? input : "");
  };
  return { api, fetchMock, url };
};

const report = {
  from: "2026-10-01",
  to: "2026-10-31",
  group: "week",
  totals: { revenue: { amount: 12_450_000, currency: "IDR" } },
} as unknown as SalesReport;

describe("getSalesReport", () => {
  it("GETs the report for the range and grouping and unwraps it", async () => {
    const { api, url } = setup(() => Response.json({ data: report }));

    await expect(
      getSalesReport(api, {
        from: "2026-10-01",
        to: "2026-10-31",
        group: "week",
      }),
    ).resolves.toEqual(report);

    expect(url().pathname).toBe("/v1/admin/reports/sales");
    expect(Object.fromEntries(url().searchParams)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      group: "week",
    });
  });

  it("sends no parameter when none is given (the API's 30 days)", async () => {
    const { api, url } = setup(() => Response.json({ data: report }));

    await getSalesReport(api);

    expect(url().search).toBe("");
  });

  it("throws the API's VALIDATION_FAILED for a range it refuses", async () => {
    const { api } = setup(() =>
      Response.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "x",
            details: { to: "y" },
          },
        },
        { status: 400 },
      ),
    );

    const error: unknown = await getSalesReport(api, {
      from: "2026-10-31",
      to: "2026-10-01",
    }).catch((e: unknown) => e);
    expect(isApiError(error, "VALIDATION_FAILED")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: report }));
    const controller = new AbortController();

    const pending = getSalesReport(api, {}, { signal: controller.signal });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
