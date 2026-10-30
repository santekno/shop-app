import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedCallback } from "./useDebouncedCallback.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const setup = (delayMs = 300) => {
  const callback = vi.fn<(text: string) => void>();
  const view = renderHook(({ fn, delay }) => useDebouncedCallback(fn, delay), {
    initialProps: { fn: callback, delay: delayMs },
  });
  return { callback, ...view };
};

describe("useDebouncedCallback", () => {
  it("runs once, with the last call's arguments, after the wait", () => {
    const { result, callback } = setup();

    act(() => {
      result.current.run("k");
      result.current.run("ka");
      result.current.run("kaos");
    });
    vi.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(callback).toHaveBeenCalledExactlyOnceWith("kaos");
  });

  it("starts the wait again on every call", () => {
    const { result, callback } = setup();

    act(() => {
      result.current.run("a");
    });
    vi.advanceTimersByTime(200);
    act(() => {
      result.current.run("ab");
    });
    vi.advanceTimersByTime(200);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(callback).toHaveBeenCalledExactlyOnceWith("ab");
  });

  it("drops a waiting call on cancel", () => {
    const { result, callback } = setup();

    act(() => {
      result.current.run("kaos");
      result.current.cancel();
    });
    vi.advanceTimersByTime(1_000);

    expect(callback).not.toHaveBeenCalled();
  });

  it("drops a waiting call when the component unmounts", () => {
    const { result, callback, unmount } = setup();

    act(() => {
      result.current.run("kaos");
    });
    unmount();
    vi.advanceTimersByTime(1_000);

    expect(callback).not.toHaveBeenCalled();
  });

  it("runs the latest callback passed in, not the one of the call", () => {
    const { result, callback, rerender } = setup();
    const later = vi.fn<(text: string) => void>();

    act(() => {
      result.current.run("kaos");
    });
    rerender({ fn: later, delay: 300 });
    vi.advanceTimersByTime(300);

    expect(callback).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledExactlyOnceWith("kaos");
  });

  it("keeps run and cancel the same across renders", () => {
    const { result, rerender } = setup();
    const { run, cancel } = result.current;

    rerender({ fn: vi.fn(), delay: 300 });

    expect(result.current.run).toBe(run);
    expect(result.current.cancel).toBe(cancel);
  });

  it("can run again after it ran", () => {
    const { result, callback } = setup(100);

    act(() => {
      result.current.run("a");
    });
    vi.advanceTimersByTime(100);
    act(() => {
      result.current.run("b");
    });
    vi.advanceTimersByTime(100);

    expect(callback.mock.calls).toEqual([["a"], ["b"]]);
  });
});
