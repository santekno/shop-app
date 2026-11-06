import { beforeEach, describe, expect, it } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";

import { product } from "@/test/fixtures";
import type { RecentItem } from "../recent-state";
import { useRecentStore } from "../store";
import {
  useRecentlyViewed,
  useRecordRecentlyViewed,
} from "./useRecentlyViewed";

const item = (slug: string): RecentItem => ({
  slug,
  name: slug,
  image: null,
  priceFrom: 1,
  hasPriceRange: false,
});

beforeEach(() => {
  useRecentStore.setState({ items: [], hydrated: false });
});

describe("useRecentlyViewed", () => {
  it("hands out the list, whether it was read yet, and a way to empty it", async () => {
    useRecentStore.setState({ items: [item("a")], hydrated: true });
    const { result } = await renderHook(() => useRecentlyViewed());

    expect(result.current.items).toEqual([item("a")]);
    expect(result.current.hydrated).toBe(true);

    await act(() => {
      result.current.clear();
    });
    expect(result.current.items).toEqual([]);
  });
});

describe("useRecordRecentlyViewed", () => {
  it("records nothing while the product has not loaded", async () => {
    await renderHook(() => {
      useRecordRecentlyViewed(undefined);
    });

    expect(useRecentStore.getState().items).toEqual([]);
  });

  it("records the product once it has loaded, as a snapshot", async () => {
    const kaos = product("Kaos Polos");
    const { rerender } = await renderHook(
      (props: { p: typeof kaos | undefined }) => {
        useRecordRecentlyViewed(props.p);
      },
      { initialProps: { p: undefined as typeof kaos | undefined } },
    );

    await rerender({ p: kaos });

    expect(useRecentStore.getState().items).toEqual([
      {
        slug: "kaos-polos",
        name: "Kaos Polos",
        image: null,
        priceFrom: 89_000,
        hasPriceRange: false,
      },
    ]);
  });

  it("a refetch of the same product leaves one entry", async () => {
    const kaos = product("Kaos Polos");
    const { rerender } = await renderHook(
      (props: { p: typeof kaos }) => {
        useRecordRecentlyViewed(props.p);
      },
      { initialProps: { p: kaos } },
    );

    await rerender({ p: { ...kaos } });

    expect(useRecentStore.getState().items).toHaveLength(1);
  });
});
