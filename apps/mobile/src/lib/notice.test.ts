import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";

import { NOTICE_MS, dismissNotice, showNotice, useNotice } from "./notice";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  dismissNotice();
  jest.useRealTimers();
});

describe("notice", () => {
  it("shows nothing until one is shown", async () => {
    const { result } = await renderHook(() => useNotice());

    expect(result.current).toBeNull();
  });

  it("shows the message, then removes it after 4 seconds", async () => {
    const { result } = await renderHook(() => useNotice());

    await act(() => {
      showNotice("Wishlist penuh");
    });
    expect(NOTICE_MS).toBe(4000);
    expect(result.current?.message).toBe("Wishlist penuh");

    await act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(result.current?.message).toBe("Wishlist penuh");

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBeNull();
  });

  it("a new notice replaces the old one and restarts the clock", async () => {
    const { result } = await renderHook(() => useNotice());

    await act(() => {
      showNotice("satu");
      jest.advanceTimersByTime(3000);
      showNotice("dua");
    });
    expect(result.current?.message).toBe("dua");

    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current?.message).toBe("dua");

    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBeNull();
  });

  it("the same sentence twice still gets a new id, so it replays", async () => {
    const { result } = await renderHook(() => useNotice());

    await act(() => {
      showNotice("sama");
    });
    const first = result.current?.id;
    await act(() => {
      showNotice("sama");
    });

    expect(result.current?.id).not.toBe(first);
  });

  it("honours a custom duration", async () => {
    const { result } = await renderHook(() => useNotice());

    await act(() => {
      showNotice("cepat", 500);
      jest.advanceTimersByTime(500);
    });

    expect(result.current).toBeNull();
  });

  it("dismissNotice removes it at once and is harmless when nothing is shown", async () => {
    const { result } = await renderHook(() => useNotice());

    await act(() => {
      dismissNotice();
      showNotice("x");
    });
    await act(() => {
      dismissNotice();
    });

    expect(result.current).toBeNull();
  });
});
