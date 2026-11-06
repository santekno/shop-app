import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act } from "@testing-library/react-native";

import { MAX_RECENT, type RecentItem } from "./recent-state";
import { RECENT_STORAGE_KEY, useRecentStore } from "./store";

const item = (slug: string): RecentItem => ({
  slug,
  name: slug.toUpperCase(),
  image: null,
  priceFrom: 10_000,
  hasPriceRange: false,
});

const stored = async () => {
  const raw = await AsyncStorage.getItem(RECENT_STORAGE_KEY);
  return raw === null
    ? null
    : (JSON.parse(raw) as { state: unknown; version: number });
};

beforeEach(async () => {
  await AsyncStorage.clear();
  useRecentStore.setState({ items: [], hydrated: false });
  jest.clearAllMocks();
});

describe("the recently viewed store", () => {
  it("is keyed goshop.recent.v1", () => {
    expect(RECENT_STORAGE_KEY).toBe("goshop.recent.v1");
  });

  it("writes only the list, at version 1: no flag, no function", async () => {
    await act(async () => {
      useRecentStore.getState().record(item("a"));
    });

    expect(await stored()).toEqual({
      state: { items: [item("a")] },
      version: 1,
    });
  });

  // zustand's persist middleware writes on every set(), even one that returns
  // the same state. What screens see is that nothing is notified and the list
  // keeps its identity.
  it("recording the product already on top notifies nobody and keeps the same list", async () => {
    await act(async () => {
      useRecentStore.getState().record(item("a"));
    });
    const before = useRecentStore.getState().items;
    const listener = jest.fn();
    const unsubscribe = useRecentStore.subscribe(listener);

    await act(async () => {
      useRecentStore.getState().record(item("a"));
    });
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
    expect(useRecentStore.getState().items).toBe(before);
  });

  it("clear empties the list and the stored copy", async () => {
    await act(async () => {
      useRecentStore.getState().record(item("a"));
      useRecentStore.getState().clear();
    });

    expect(useRecentStore.getState().items).toEqual([]);
    expect((await stored())?.state).toEqual({ items: [] });
  });

  it("reads the stored list back, checked, and marks itself hydrated", async () => {
    await AsyncStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { items: [item("a"), { slug: "rusak" }, item("b")] },
      }),
    );

    await act(async () => {
      await useRecentStore.persist.rehydrate();
    });

    expect(useRecentStore.getState().items.map((i) => i.slug)).toEqual([
      "a",
      "b",
    ]);
    expect(useRecentStore.getState().hydrated).toBe(true);
  });

  it("with nothing stored, is hydrated and empty", async () => {
    await act(async () => {
      await useRecentStore.persist.rehydrate();
    });

    expect(useRecentStore.getState()).toMatchObject({
      items: [],
      hydrated: true,
    });
  });

  it("a product recorded while the read was running stays first, and is not duplicated", async () => {
    // setState writes the store to storage, so it goes before the stored copy.
    useRecentStore.setState({ items: [item("new")] });
    await AsyncStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { items: [item("old1"), item("new"), item("old2")] },
      }),
    );

    await act(async () => {
      await useRecentStore.persist.rehydrate();
    });

    expect(useRecentStore.getState().items.map((i) => i.slug)).toEqual([
      "new",
      "old1",
      "old2",
    ]);
  });

  it("caps the merged list at 10", async () => {
    const many = Array.from({ length: MAX_RECENT }, (_, i) => item(`s${i}`));
    useRecentStore.setState({ items: [item("fresh")] });
    await AsyncStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify({ version: 1, state: { items: many } }),
    );

    await act(async () => {
      await useRecentStore.persist.rehydrate();
    });

    const slugs = useRecentStore.getState().items.map((i) => i.slug);
    expect(slugs).toHaveLength(10);
    expect(slugs[0]).toBe("fresh");
  });

  it("a storage that cannot be read still ends hydrated, with an empty list", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValueOnce(new Error("disk"));

    await act(async () => {
      await useRecentStore.persist.rehydrate();
    });

    expect(useRecentStore.getState()).toMatchObject({
      items: [],
      hydrated: true,
    });
    jest.restoreAllMocks();
  });

  it("ignores stored garbage that is not even a list", async () => {
    await AsyncStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify({ version: 1, state: { items: "oops" } }),
    );

    await act(async () => {
      await useRecentStore.persist.rehydrate();
    });

    expect(useRecentStore.getState().items).toEqual([]);
  });
});
