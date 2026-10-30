import { describe, expect, it } from "vitest";
import { isOrdersPath } from "./order-events-context.ts";
import { MAX_TOASTS, initialToastState, toastReducer } from "./toasts.ts";
import type { ToastState } from "./toasts.ts";

const add = (state: ToastState, id: string) =>
  toastReducer(state, { type: "add", toast: { id, message: `Pesanan ${id}` } });

describe("toastReducer", () => {
  it("adds a toast and announces its message", () => {
    const state = add(initialToastState, "a");

    expect(state).toEqual({
      toasts: [{ id: "a", message: "Pesanan a" }],
      announcement: "Pesanan a",
    });
  });

  it("ignores a toast it already shows, returning the same state", () => {
    const state = add(initialToastState, "a");

    expect(add(state, "a")).toBe(state);
  });

  it("keeps the newest three, dropping the oldest", () => {
    const state = ["a", "b", "c", "d"].reduce(add, initialToastState);

    expect(MAX_TOASTS).toBe(3);
    expect(state.toasts.map((toast) => toast.id)).toEqual(["b", "c", "d"]);
    expect(state.announcement).toBe("Pesanan d");
  });

  it("dismisses one toast and keeps the announcement", () => {
    const state = toastReducer(add(add(initialToastState, "a"), "b"), {
      type: "dismiss",
      id: "b",
    });

    expect(state.toasts.map((toast) => toast.id)).toEqual(["a"]);
    expect(state.announcement).toBe("Pesanan b");
  });

  it("changes nothing visible when dismissing an unknown toast", () => {
    const state = add(initialToastState, "a");

    expect(toastReducer(state, { type: "dismiss", id: "x" }).toasts).toEqual(
      state.toasts,
    );
  });
});

describe("isOrdersPath", () => {
  it.each([
    ["/pesanan", true],
    ["/pesanan/o-1", true],
    ["/pesanan/o-1/resi", true],
    ["/pesananku", false],
    ["/", false],
    ["/produk", false],
  ])("%s is an orders page: %s", (path, expected) => {
    expect(isOrdersPath(path)).toBe(expected);
  });
});
