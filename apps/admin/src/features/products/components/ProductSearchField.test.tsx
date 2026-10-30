import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProductSearchField,
  SEARCH_DEBOUNCE_MS,
} from "./ProductSearchField.tsx";

// Typing is driven with fireEvent on a fake clock: user-event's own
// delays would run on the same fake timers and the debounce with them.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const renderField = (value?: string) => {
  const onSearch = vi.fn<(q: string | undefined) => void>();
  const view = render(<ProductSearchField value={value} onSearch={onSearch} />);
  const rerender = (next: string | undefined) => {
    view.rerender(<ProductSearchField value={next} onSearch={onSearch} />);
  };
  return { onSearch, rerender };
};

const field = () => screen.getByRole("searchbox", { name: "Cari produk" });
const type = (text: string) => {
  fireEvent.change(field(), { target: { value: text } });
};
const elapse = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("ProductSearchField", () => {
  it("is a search landmark with a labelled search box, prefilled from the URL", () => {
    renderField("kaos");

    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(field()).toHaveValue("kaos");
    expect(field()).toHaveAttribute("maxLength", "100");
  });

  it("searches 300 ms after the last keystroke, once", () => {
    const { onSearch } = renderField();

    type("k");
    type("ka");
    type("kaos");
    elapse(SEARCH_DEBOUNCE_MS - 1);
    expect(onSearch).not.toHaveBeenCalled();
    elapse(1);

    expect(SEARCH_DEBOUNCE_MS).toBe(300);
    expect(onSearch).toHaveBeenCalledExactlyOnceWith("kaos");
  });

  it("searches at once on Enter, without a second search later", () => {
    const { onSearch } = renderField();

    type("topi");
    fireEvent.submit(screen.getByRole("search"));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith("topi");
    elapse(1_000);

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("sends the search trimmed, and spaces alone as no search", () => {
    const { onSearch } = renderField("kaos");

    type("  topi  ");
    elapse(SEARCH_DEBOUNCE_MS);
    type("   ");
    elapse(SEARCH_DEBOUNCE_MS);

    expect(onSearch.mock.calls).toEqual([["topi"], [undefined]]);
    expect(field()).toHaveValue("   ");
  });

  it("shows a search that comes from outside (Back, Hapus filter)", () => {
    const { rerender } = renderField("kaos");

    rerender(undefined);
    expect(field()).toHaveValue("");
    rerender("topi");

    expect(field()).toHaveValue("topi");
  });

  it("does not overwrite what is being typed when its own search arrives in the URL", () => {
    const { onSearch, rerender } = renderField();

    type("ka");
    elapse(SEARCH_DEBOUNCE_MS);
    expect(onSearch).toHaveBeenLastCalledWith("ka");
    type("kaos");
    // The URL now catches up with "ka", the search this field sent.
    rerender("ka");

    expect(field()).toHaveValue("kaos");
    elapse(SEARCH_DEBOUNCE_MS);
    expect(onSearch).toHaveBeenLastCalledWith("kaos");
  });

  it("keeps the text typed with trailing spaces when its own trimmed search arrives", () => {
    const { rerender } = renderField();

    type("kaos ");
    elapse(SEARCH_DEBOUNCE_MS);
    rerender("kaos");

    expect(field()).toHaveValue("kaos ");
  });

  it("drops a waiting search when another search arrives from outside first", () => {
    const { onSearch, rerender } = renderField("kaos");

    type("kaos polos");
    elapse(SEARCH_DEBOUNCE_MS - 100);
    // Back, or Hapus filter, before the wait is over.
    rerender("topi");
    elapse(SEARCH_DEBOUNCE_MS);

    expect(field()).toHaveValue("topi");
    expect(onSearch).not.toHaveBeenCalled();
  });
});
