import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderEventsContext } from "../order-events-context.ts";
import type { OrderEventsValue } from "../order-events-context.ts";
import { initialToastState, toastReducer } from "../toasts.ts";
import { OrderToasts, TOAST_DURATION_MS } from "./OrderToasts.tsx";

// The toasts read the provider's context only; this harness is that
// context with the real reducer, so a test adds a toast the way an
// order.paid event would, with no stream and on a fake clock.
let addToast: (id: string) => void = () => undefined;
const register = (add: (id: string) => void) => {
  addToast = add;
};

function Harness() {
  const [state, dispatch] = useReducer(toastReducer, initialToastState);
  const dismissToast = useCallback((id: string) => {
    dispatch({ type: "dismiss", id });
  }, []);
  useEffect(() => {
    register((id) => {
      dispatch({
        type: "add",
        toast: { id, message: `Pesanan baru GS-${id}` },
      });
    });
  }, []);
  const value = useMemo(
    (): OrderEventsValue => ({
      status: "live",
      retryNow: () => undefined,
      unread: 0,
      toasts: state.toasts,
      announcement: state.announcement,
      dismissToast,
    }),
    [state, dismissToast],
  );
  return (
    <OrderEventsContext value={value}>
      <main id="konten" tabIndex={-1}>
        <button type="button">Isi halaman</button>
      </main>
      <OrderToasts />
    </OrderEventsContext>
  );
}

const renderToasts = () => {
  // The toasts stay mounted across a navigation, as in the layout.
  const router = createMemoryRouter([{ path: "*", element: <Harness /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);
  return router;
};

const add = (id: string) => {
  act(() => {
    addToast(id);
  });
};
const stack = () =>
  screen.queryByRole("region", { name: "Notifikasi pesanan" });
const toastTexts = () =>
  within(stack() ?? document.body)
    .queryAllByRole("listitem")
    .map((item) => within(item).getByText(/^Pesanan baru/).textContent);
const elapse = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("OrderToasts", () => {
  it("announces the newest order in a polite live region, apart from the toasts", () => {
    renderToasts();
    const live = screen.getByRole("status");

    expect(live).toHaveAttribute("aria-live", "polite");
    expect(stack()).toBeNull();
    add("1");

    expect(live).toHaveTextContent("Pesanan baru GS-1");
    expect(within(live).queryByRole("link")).toBeNull();
    expect(toastTexts()).toEqual(["Pesanan baru GS-1"]);
  });

  it("removes a toast after 8 seconds", () => {
    renderToasts();
    add("1");

    expect(TOAST_DURATION_MS).toBe(8_000);
    elapse(7_999);
    expect(toastTexts()).toEqual(["Pesanan baru GS-1"]);
    elapse(1);
    expect(stack()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Pesanan baru GS-1");
  });

  it("pauses while the pointer is over the stack, then counts only the time left", () => {
    renderToasts();
    add("1");
    elapse(5_000);

    fireEvent.mouseEnter(
      screen.getByRole("region", { name: "Notifikasi pesanan" }),
    );
    elapse(60_000);
    expect(toastTexts()).toEqual(["Pesanan baru GS-1"]);
    fireEvent.mouseLeave(
      screen.getByRole("region", { name: "Notifikasi pesanan" }),
    );
    elapse(2_999);
    expect(toastTexts()).toHaveLength(1);
    elapse(1);

    expect(stack()).toBeNull();
  });

  it("pauses while the focus is inside the stack", () => {
    renderToasts();
    add("1");

    act(() => {
      screen.getByRole("link", { name: "Lihat pesanan" }).focus();
    });
    elapse(20_000);
    expect(toastTexts()).toHaveLength(1);
    act(() => {
      screen.getByRole("button", { name: "Isi halaman" }).focus();
    });
    elapse(8_000);

    expect(stack()).toBeNull();
  });

  it("keeps counting while the focus moves between the stack's own controls", () => {
    renderToasts();
    add("1");
    act(() => {
      screen.getByRole("link", { name: "Lihat pesanan" }).focus();
    });
    act(() => {
      screen.getByRole("button", { name: /Tutup notifikasi/ }).focus();
    });

    elapse(20_000);

    expect(toastTexts()).toHaveLength(1);
  });

  it("pauses while the tab is hidden", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    renderToasts();
    add("1");

    visibility.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    elapse(60_000);
    expect(toastTexts()).toHaveLength(1);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    elapse(8_000);

    expect(stack()).toBeNull();
  });

  it("dismisses a toast from its close button", () => {
    renderToasts();
    add("1");
    add("2");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Tutup notifikasi Pesanan baru GS-1",
      }),
    );

    expect(toastTexts()).toEqual(["Pesanan baru GS-2"]);
  });

  it("hands the focus to the next toast when the focused one is closed", () => {
    renderToasts();
    add("1");
    add("2");
    const close = screen.getByRole("button", {
      name: "Tutup notifikasi Pesanan baru GS-1",
    });
    act(() => {
      close.focus();
    });

    fireEvent.click(close);

    expect(
      screen.getByRole("button", {
        name: "Tutup notifikasi Pesanan baru GS-2",
      }),
    ).toHaveFocus();
  });

  it("hands the focus to the previous toast when the last one is closed", () => {
    renderToasts();
    add("1");
    add("2");
    const close = screen.getByRole("button", {
      name: "Tutup notifikasi Pesanan baru GS-2",
    });
    act(() => {
      close.focus();
    });

    fireEvent.click(close);

    expect(
      screen.getByRole("button", {
        name: "Tutup notifikasi Pesanan baru GS-1",
      }),
    ).toHaveFocus();
  });

  it("hands the focus to the page when the only toast is closed", () => {
    renderToasts();
    add("1");
    const close = screen.getByRole("button", { name: /Tutup notifikasi/ });
    act(() => {
      close.focus();
    });

    fireEvent.click(close);

    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("closes the focused toast on Escape", () => {
    renderToasts();
    add("1");
    const link = screen.getByRole("link", { name: "Lihat pesanan" });
    act(() => {
      link.focus();
    });

    fireEvent.keyDown(link, { key: "Escape" });

    expect(stack()).toBeNull();
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("ignores other keys", () => {
    renderToasts();
    add("1");

    fireEvent.keyDown(screen.getByRole("link", { name: "Lihat pesanan" }), {
      key: "Enter",
    });

    expect(toastTexts()).toHaveLength(1);
  });

  it("opens the orders page from the toast and dismisses it", () => {
    const router = renderToasts();
    add("1");

    fireEvent.click(screen.getByRole("link", { name: "Lihat pesanan" }));

    expect(router.state.location.pathname).toBe("/pesanan");
    expect(stack()).toBeNull();
  });

  it("never moves the focus when a toast arrives", () => {
    renderToasts();
    const page = screen.getByRole("button", { name: "Isi halaman" });
    act(() => {
      page.focus();
    });

    add("1");

    expect(page).toHaveFocus();
  });
});
