import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRouteHook } from "@/test/render.tsx";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard.ts";

const setup = (dirty: boolean) =>
  renderRouteHook(
    (props: { dirty: boolean }) => useUnsavedChangesGuard(props.dirty),
    {
      url: "/produk/p-1",
      initialProps: { dirty },
    },
  );

/** Fires beforeunload as the browser does; true when the page asked to stay. */
const unloadIsHeld = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("useUnsavedChangesGuard", () => {
  it("lets a clean form leave", async () => {
    const { result, router } = setup(false);

    await act(() => router.navigate("/produk"));

    expect(router.state.location.pathname).toBe("/produk");
    expect(result.current.blocker.state).toBe("unblocked");
  });

  it("stops a dirty form leaving for another path, until the user proceeds", async () => {
    const { result, router } = setup(true);

    await act(() => router.navigate("/produk"));

    expect(result.current.blocker.state).toBe("blocked");
    expect(router.state.location.pathname).toBe("/produk/p-1");
    await act(async () => {
      result.current.blocker.proceed?.();
      await Promise.resolve();
    });
    expect(router.state.location.pathname).toBe("/produk");
  });

  it("stays when the user says so", async () => {
    const { result, router } = setup(true);
    await act(() => router.navigate("/laporan"));

    act(() => {
      result.current.blocker.reset?.();
    });

    expect(result.current.blocker.state).toBe("unblocked");
    expect(router.state.location.pathname).toBe("/produk/p-1");
  });

  it("does not stop a change of the query string or the hash", async () => {
    const { result, router } = setup(true);

    await act(() => router.navigate("/produk/p-1?langkah=2#varian"));

    expect(result.current.blocker.state).toBe("unblocked");
    expect(router.state.location.search).toBe("?langkah=2");
  });

  it("lets the form leave once allowNavigation was called", async () => {
    const { result, router } = setup(true);

    act(() => {
      result.current.allowNavigation();
    });
    await act(() => router.navigate("/produk/p-2"));

    expect(router.state.location.pathname).toBe("/produk/p-2");
  });

  it("asks the browser to hold a reload or a closed tab only while dirty", () => {
    const { rerender, unmount } = setup(false);
    expect(unloadIsHeld()).toBe(false);

    rerender({ dirty: true });
    expect(unloadIsHeld()).toBe(true);

    rerender({ dirty: false });
    expect(unloadIsHeld()).toBe(false);

    rerender({ dirty: true });
    unmount();
    expect(unloadIsHeld()).toBe(false);
  });
});
