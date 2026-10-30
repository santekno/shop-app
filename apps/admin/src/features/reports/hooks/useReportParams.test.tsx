import { act, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { renderRouteHook } from "@/test/render.tsx";
import { useReportParams } from "./useReportParams.ts";

describe("useReportParams", () => {
  it("reads the report's state from the URL", () => {
    const { result } = renderRouteHook(() => useReportParams(), {
      url: "/laporan?rentang=7&kelompok=bulan",
    });

    expect(result.current.params).toEqual({
      range: { kind: "preset", days: 7 },
      group: "month",
    });
  });

  it("renders the change before the URL has it", async () => {
    // Every render: the grouping shown, and the URL it was rendered with.
    const renders: string[] = [];
    const { result } = renderRouteHook(
      () => {
        const value = useReportParams();
        renders.push(`${value.params.group} @${useLocation().search}`);
        return value;
      },
      { url: "/laporan" },
    );

    act(() => {
      result.current.update({ group: "week" });
    });
    await waitFor(() => {
      expect(renders.at(-1)).toBe("week @?kelompok=minggu");
    });

    expect(renders).toContain("week @");
  });

  it("shows a change at once, before the URL has it, then writes it to the URL", async () => {
    const { result, router } = renderRouteHook(() => useReportParams(), {
      url: "/laporan",
    });

    act(() => {
      result.current.update({ group: "week" });
    });

    expect(result.current.params.group).toBe("week");
    await waitFor(() => {
      expect(router.state.location.search).toBe("?kelompok=minggu");
    });
  });

  it("keeps what the URL already had when one part changes", async () => {
    const { result, router } = renderRouteHook(() => useReportParams(), {
      url: "/laporan?rentang=90",
    });

    act(() => {
      result.current.update({ group: "month" });
    });

    expect(result.current.params).toEqual({
      range: { kind: "preset", days: 90 },
      group: "month",
    });
    await waitFor(() => {
      expect(router.state.location.search).toBe("?rentang=90&kelompok=bulan");
    });
  });

  it("lets a URL that arrives later win over what was pending", async () => {
    const { result, router } = renderRouteHook(() => useReportParams(), {
      url: "/laporan",
    });

    act(() => {
      result.current.update({ group: "week" });
    });
    await act(() => router.navigate("/laporan?rentang=7"));

    expect(result.current.params).toEqual({
      range: { kind: "preset", days: 7 },
      group: "day",
    });
  });
});
