import { ApiError } from "@goshop/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductListFooter } from "./ProductListFooter.tsx";

type Props = ComponentProps<typeof ProductListFooter>;

const base: Props = {
  count: 12,
  filtered: false,
  hasNextPage: true,
  isFetching: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  error: null,
  fetchNextPage: () => undefined,
};

/** Observers created by the footer's sentinel, driven by the test. */
let observers: {
  callback: IntersectionObserverCallback;
  disconnected: boolean;
}[];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: { callback: IntersectionObserverCallback; disconnected: boolean };
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, disconnected: false };
        observers.push(this.entry);
      }
      observe() {
        return undefined;
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const scrollIntoView = () => {
  const observer = observers.at(-1);
  if (!observer || observer.disconnected) {
    throw new Error("no active sentinel");
  }
  observer.callback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
};

const activeSentinels = () => observers.filter((o) => !o.disconnected).length;

describe("ProductListFooter", () => {
  it("offers Muat lebih banyak and loads the next page when the sentinel scrolls into view", async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    render(<ProductListFooter {...base} fetchNextPage={fetchNextPage} />);

    scrollIntoView();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Muat lebih banyak" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("says Memuat produk berikutnya… while the next page loads, with no button and no sentinel", () => {
    render(<ProductListFooter {...base} isFetching isFetchingNextPage />);

    expect(screen.getByRole("status").textContent).toBe(
      "Memuat produk berikutnya…",
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(activeSentinels()).toBe(0);
  });

  it("does not load by itself while any request runs, and disables the button", async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    render(
      <ProductListFooter {...base} isFetching fetchNextPage={fetchNextPage} />,
    );

    expect(activeSentinels()).toBe(0);
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Muat lebih banyak",
    });
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("enables the button again once nothing is fetching", () => {
    render(<ProductListFooter {...base} />);

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Muat lebih banyak",
      }).disabled,
    ).toBe(false);
  });

  it("shows a failed next page with Coba lagi, and never loads it again by itself", async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    render(
      <ProductListFooter
        {...base}
        isFetchNextPageError
        error={
          new ApiError({ status: 503, code: "INTERNAL_ERROR", message: "x" })
        }
        fetchNextPage={fetchNextPage}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Muat lebih banyak" }),
    ).toBeNull();
    expect(activeSentinels()).toBe(0);
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ count: 3 }, "Semua produk sudah ditampilkan."],
    [{ count: 0 }, "Belum ada produk."],
    [{ count: 0, filtered: true }, "Tidak ada produk yang cocok."],
  ])("ends a complete list (%o) with %j", (props, text) => {
    render(<ProductListFooter {...base} {...props} hasNextPage={false} />);

    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(observers).toHaveLength(0);
  });

  it("keeps loading while a page is empty but has a cursor", () => {
    render(<ProductListFooter {...base} count={0} />);

    expect(screen.queryByText("Belum ada produk.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Muat lebih banyak" }),
    ).toBeTruthy();
    expect(activeSentinels()).toBe(1);
  });
});
