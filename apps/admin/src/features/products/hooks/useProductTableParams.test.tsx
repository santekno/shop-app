import { act, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { renderRouteHook } from "@/test/render.tsx";
import { DEFAULT_PRODUCT_TABLE_PARAMS } from "../product-table-params.ts";
import { useProductTableParams } from "./useProductTableParams.ts";

const search = (router: { state: { location: { search: string } } }) =>
  router.state.location.search;

describe("useProductTableParams", () => {
  it("reads the table's state from the URL", () => {
    const { result } = renderRouteHook(() => useProductTableParams(), {
      url: "/produk?q=kaos&status=draf&halaman=3",
    });

    expect(result.current.params).toEqual({
      ...DEFAULT_PRODUCT_TABLE_PARAMS,
      q: "kaos",
      status: "draft",
      page: 3,
    });
  });

  it("keeps the same params object while the query string is the same", async () => {
    const { result, router, rerender } = renderRouteHook(
      () => useProductTableParams(),
      { url: "/produk?q=kaos" },
    );
    const first = result.current.params;

    rerender();
    expect(result.current.params).toBe(first);
    await act(() => router.navigate("/produk?q=kaos#atas"));
    expect(result.current.params).toBe(first);
    await act(() => router.navigate("/produk?q=topi"));

    expect(result.current.params).not.toBe(first);
    expect(result.current.params.q).toBe("topi");
  });

  it("writes a change to the URL and goes back to page 1", async () => {
    const { result, router } = renderRouteHook(() => useProductTableParams(), {
      url: "/produk?halaman=4",
    });

    act(() => {
      result.current.update({ status: "active" });
    });

    await waitFor(() => {
      expect(search(router)).toBe("?status=aktif");
    });
    expect(result.current.params.page).toBe(1);
    expect(router.state.historyAction).toBe("PUSH");
  });

  it("keeps the page a change names", async () => {
    const { result, router } = renderRouteHook(() => useProductTableParams(), {
      url: "/produk?status=aktif",
    });

    act(() => {
      result.current.update({ page: 2 });
    });

    await waitFor(() => {
      expect(search(router)).toBe("?status=aktif&halaman=2");
    });
  });

  it("renders the new state before the URL has it", async () => {
    const renders: string[] = [];
    const { result } = renderRouteHook(
      () => {
        const value = useProductTableParams();
        renders.push(`${value.params.status ?? "-"} @${useLocation().search}`);
        return value;
      },
      { url: "/produk" },
    );

    act(() => {
      result.current.update({ status: "draft" });
    });
    await waitFor(() => {
      expect(renders.at(-1)).toBe("draft @?status=draf");
    });

    expect(renders).toContain("draft @");
  });

  it("lets a URL that arrives later win over what was pending", async () => {
    const { result, router } = renderRouteHook(() => useProductTableParams(), {
      url: "/produk",
    });

    act(() => {
      result.current.update({ status: "draft" });
    });
    await act(() => router.navigate("/produk?urut=nama&arah=naik"));

    expect(result.current.params).toEqual({
      ...DEFAULT_PRODUCT_TABLE_PARAMS,
      sort: "name",
      order: "asc",
    });
  });

  // Several updates in one event (7c7f9d61): each builds on the one
  // before, while the URL is still the one it was made against.
  describe("several updates", () => {
    it("applies both of two updates made in one act", async () => {
      const { result, router } = renderRouteHook(
        () => useProductTableParams(),
        { url: "/produk" },
      );

      act(() => {
        result.current.update({ q: "kaos" });
        result.current.update({ status: "active" });
      });

      expect(result.current.params.q).toBe("kaos");
      expect(result.current.params.status).toBe("active");
      await waitFor(() => {
        expect(search(router)).toBe("?q=kaos&status=aktif");
      });
      expect(result.current.params.q).toBe("kaos");
    });

    it("applies both of two updates made in separate acts", async () => {
      const { result, router } = renderRouteHook(
        () => useProductTableParams(),
        { url: "/produk" },
      );
      const { update } = result.current;

      act(() => {
        update({ q: "kaos" });
      });
      act(() => {
        update({ status: "active" });
      });

      await waitFor(() => {
        expect(search(router)).toBe("?q=kaos&status=aktif");
      });
    });

    it("builds on a link that arrived, not on the update before it", async () => {
      const { result, router } = renderRouteHook(
        () => useProductTableParams(),
        { url: "/produk" },
      );

      act(() => {
        result.current.update({ q: "kaos" });
      });
      await waitFor(() => {
        expect(search(router)).toBe("?q=kaos");
      });
      await act(() => router.navigate("/produk?status=draf"));
      expect(result.current.params.status).toBe("draft");
      expect(result.current.params.q).toBeUndefined();

      act(() => {
        result.current.update({ page: 2 });
      });

      await waitFor(() => {
        expect(search(router)).toBe("?status=draf&halaman=2");
      });
    });

    it("builds on the URL Back returned to", async () => {
      const { result, router } = renderRouteHook(
        () => useProductTableParams(),
        { url: "/produk?status=draf" },
      );

      act(() => {
        result.current.update({ q: "kaos" });
      });
      await waitFor(() => {
        expect(search(router)).toBe("?q=kaos&status=draf");
      });
      await act(() => router.navigate(-1));
      expect(search(router)).toBe("?status=draf");

      act(() => {
        result.current.update({ lowStock: true });
      });

      await waitFor(() => {
        expect(search(router)).toBe("?status=draf&stok=menipis");
      });
    });
  });

  describe("replace", () => {
    it("replaces the history entry for that one navigation only", async () => {
      const { result, router } = renderRouteHook(
        () => useProductTableParams(),
        { url: "/produk" },
      );

      act(() => {
        result.current.update({ q: "ka" });
      });
      await waitFor(() => {
        expect(search(router)).toBe("?q=ka");
      });
      expect(router.state.historyAction).toBe("PUSH");

      act(() => {
        result.current.update({ q: "kaos" }, { replace: true });
      });
      await waitFor(() => {
        expect(search(router)).toBe("?q=kaos");
      });
      expect(router.state.historyAction).toBe("REPLACE");

      act(() => {
        result.current.update({ status: "active" });
      });
      await waitFor(() => {
        expect(search(router)).toBe("?q=kaos&status=aktif");
      });
      expect(router.state.historyAction).toBe("PUSH");

      // "?q=ka" was replaced: Back skips it.
      await act(() => router.navigate(-1));
      expect(search(router)).toBe("?q=kaos");
      await act(() => router.navigate(-1));
      expect(search(router)).toBe("");
    });
  });
});
