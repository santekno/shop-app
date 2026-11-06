import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";

import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("returns the first value at once, without waiting", async () => {
    const { result } = await renderHook(() => useDebouncedValue("kaos", 300));

    expect(result.current).toBe("kaos");
  });

  it("follows a change only after the delay", async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );

    await rerender({ value: "ab" });
    await act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(result.current).toBe("a");

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe("ab");
  });

  it("a burst of changes gives one value at the end, each change restarting the wait", async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 300),
      { initialProps: { value: "" } },
    );

    await rerender({ value: "k" });
    await act(() => {
      jest.advanceTimersByTime(200);
    });
    await rerender({ value: "ka" });
    await act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe("");

    await act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current).toBe("ka");
  });

  it("clears the pending timer on unmount", async () => {
    const { rerender, unmount } = await renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );
    await rerender({ value: "b" });

    const cleared = jest.spyOn(globalThis, "clearTimeout");

    await unmount();

    expect(cleared).toHaveBeenCalledTimes(1);
    cleared.mockRestore();
  });
});
