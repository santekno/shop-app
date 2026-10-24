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
});
