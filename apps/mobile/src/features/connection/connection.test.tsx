import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react-native";

import { renderHookWithProviders, renderWithProviders, createTestQueryClient } from "@/test/render";
import { ConnectionBanner } from "./ConnectionBanner";
import { RESTORED_VISIBLE_MS, refetchAfterReconnect, useConnectionBanner } from "./useConnectionBanner";
import { useIsOnline } from "./useIsOnline";

const OFFLINE_TEXT = "Anda sedang offline. Data yang tampil mungkin sudah lama.";
const RESTORED_TEXT = "Kembali online. Memperbarui data…";

beforeEach(() => {
  jest.useFakeTimers();
  onlineManager.setOnline(true);
});
afterEach(() => {
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

const setOnline = (value: boolean) =>
  act(() => {
    onlineManager.setOnline(value);
  });

describe("useIsOnline", () => {
  it("follows the app's online state", async () => {
    const { result } = await renderHookWithProviders(() => useIsOnline());
    expect(result.current).toBe(true);

    await setOnline(false);
    expect(result.current).toBe(false);

    await setOnline(true);
    expect(result.current).toBe(true);
  });

  it("starts offline when the phone is", async () => {
    onlineManager.setOnline(false);
    const { result } = await renderHookWithProviders(() => useIsOnline());

    expect(result.current).toBe(false);
  });
});

describe("useConnectionBanner", () => {
  it("is hidden for a phone that starts online, and never says 'restored'", async () => {
    const { result } = await renderHookWithProviders(() => useConnectionBanner());
    expect(result.current).toBe("hidden");

    await act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe("hidden");
  });

  it("is offline while there is no network, including at launch", async () => {
    onlineManager.setOnline(false);
    const { result } = await renderHookWithProviders(() => useConnectionBanner());

    expect(result.current).toBe("offline");
  });

  it("says 'restored' for 3 s after the network returns, then hides", async () => {
    const { result } = await renderHookWithProviders(() => useConnectionBanner());
    await setOnline(false);
    expect(result.current).toBe("offline");

    await setOnline(true);
    expect(result.current).toBe("restored");
    expect(RESTORED_VISIBLE_MS).toBe(3000);

    await act(() => {
      jest.advanceTimersByTime(2_999);
    });
    expect(result.current).toBe("restored");
    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe("hidden");
  });

  it("going offline again within the 3 s shows offline, and the old timer does not hide the next 'restored'", async () => {
    const { result } = await renderHookWithProviders(() => useConnectionBanner());
    await setOnline(false);
    await setOnline(true);
    await act(() => {
      jest.advanceTimersByTime(2_000);
    });
    await setOnline(false);
    expect(result.current).toBe("offline");

    await setOnline(true);
    await act(() => {
      jest.advanceTimersByTime(2_000);
    });
    // 4 s after the first return, but only 2 s after the second one.
    expect(result.current).toBe("restored");
  });

  it("refetches the active, stale queries when the network returns", async () => {
    const client = createTestQueryClient();
    const spy = jest.spyOn(client, "refetchQueries");
    await renderHookWithProviders(() => useConnectionBanner(), client);

    await setOnline(false);
    expect(spy).not.toHaveBeenCalled();
    await setOnline(true);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      { type: "active", stale: true },
      { cancelRefetch: false },
    );
  });
});

describe("refetchAfterReconnect", () => {
  it("refetches only the queries a screen uses that are out of date", async () => {
    const calls = { stale: 0, fresh: 0, unused: 0 };
    const Screen = () => {
      useQuery({
        queryKey: ["stale"],
        queryFn: () => Promise.resolve((calls.stale += 1)),
        staleTime: 0,
      });
      useQuery({
        queryKey: ["fresh"],
        queryFn: () => Promise.resolve((calls.fresh += 1)),
        staleTime: Infinity,
      });
      return null;
    };
    const client = createTestQueryClient();
    // In the cache, out of date, but no screen shows it.
    await client.prefetchQuery({
      queryKey: ["unused"],
      queryFn: () => Promise.resolve((calls.unused += 1)),
      staleTime: 0,
    });
    await renderWithProviders(<Screen />, client);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(calls).toEqual({ stale: 1, fresh: 1, unused: 1 });

    await act(async () => {
      await refetchAfterReconnect(client);
    });

    expect(calls).toEqual({ stale: 2, fresh: 1, unused: 1 });
  });
});

describe("ConnectionBanner", () => {
  it("draws nothing while online", async () => {
    const { toJSON } = await renderWithProviders(<ConnectionBanner />);

    expect(toJSON()).toBeNull();
  });

  it("offline: an alert with the offline sentence", async () => {
    onlineManager.setOnline(false);
    await renderWithProviders(<ConnectionBanner />);

    expect(screen.getByRole("alert", { name: OFFLINE_TEXT })).toBeTruthy();
    expect(screen.getByText(OFFLINE_TEXT)).toBeTruthy();
  });

  it("back online: says it is updating, then goes away after 3 s", async () => {
    await renderWithProviders(<ConnectionBanner />);

    await setOnline(false);
    await setOnline(true);
    expect(screen.getByRole("alert", { name: RESTORED_TEXT })).toBeTruthy();

    await act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
