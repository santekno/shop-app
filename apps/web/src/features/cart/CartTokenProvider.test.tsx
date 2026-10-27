import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CartTokenProvider } from "./CartTokenProvider.tsx";
import { useCartToken } from "./cart-token-context.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartTokenProvider>{children}</CartTokenProvider>
);

describe("CartTokenProvider and useCartToken", () => {
  it("start without a token and keep the one that is set", () => {
    const { result } = renderHook(() => useCartToken(), { wrapper });
    expect(result.current.cartToken).toBeNull();

    act(() => {
      result.current.setCartToken("tok");
    });
    expect(result.current.cartToken).toBe("tok");

    act(() => {
      result.current.setCartToken(null);
    });
    expect(result.current.cartToken).toBeNull();
  });

  it("keep the same value object while the token does not change", () => {
    const { result, rerender } = renderHook(() => useCartToken(), { wrapper });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("make useCartToken throw outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useCartToken())).toThrow(
      "useCartToken must be used inside <CartTokenProvider>",
    );
  });

  it("make getCartToken return a new token at once, before any render", () => {
    const { result } = renderHook(() => useCartToken(), { wrapper });
    const seen: (string | null)[] = [];

    act(() => {
      result.current.setCartToken("t1");
      seen.push(result.current.getCartToken(), result.current.cartToken);
    });

    // The ref has the new token; the rendered value catches up after.
    expect(seen).toEqual(["t1", null]);
    expect(result.current.cartToken).toBe("t1");
  });

  it("keep getCartToken the same function across tokens", () => {
    const { result } = renderHook(() => useCartToken(), { wrapper });
    const first = result.current.getCartToken;

    act(() => {
      result.current.setCartToken("t1");
    });

    expect(result.current.getCartToken).toBe(first);
  });
});
