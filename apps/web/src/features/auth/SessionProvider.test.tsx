import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { user } from "@/test/fake-api.ts";
import { SessionProvider } from "./SessionProvider.tsx";
import { useSession } from "./session-context.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SessionProvider>{children}</SessionProvider>
);

describe("SessionProvider and useSession", () => {
  it("start logged out and keep the session that is set", () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.session).toBeNull();

    act(() => {
      result.current.setSession({ user: user(), accessToken: "a" });
    });
    expect(result.current.session).toEqual({ user: user(), accessToken: "a" });

    act(() => {
      result.current.setSession(null);
    });
    expect(result.current.session).toBeNull();
  });

  it("keep the same value object while the session does not change", () => {
    const { result, rerender } = renderHook(() => useSession(), { wrapper });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("make useSession throw outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useSession())).toThrow(
      "useSession must be used inside <SessionProvider>",
    );
  });
});
