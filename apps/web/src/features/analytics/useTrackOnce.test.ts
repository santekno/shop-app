import type { EcommerceEvent } from "@goshop/shared";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrackOnce } from "./useTrackOnce.ts";

const gtag = vi.fn();

const view = (name: string): EcommerceEvent => ({
  name: "view_item",
  params: {
    currency: "IDR",
    value: 1,
    items: [{ item_name: name, price: 1, quantity: 1 }],
  },
});

/** The item_name of every view_item sent. */
const sent = () =>
  gtag.mock.calls.map(
    ([, , params]) =>
      (params as { items: { item_name: string }[] }).items[0]?.item_name,
  );

beforeEach(() => {
  gtag.mockReset();
  window.gtag = gtag;
});

afterEach(() => {
  delete window.gtag;
});

describe("useTrackOnce", () => {
  it("sends the event once per key, however often the page renders", () => {
    const { rerender } = renderHook(
      ({ event, key }) => {
        useTrackOnce(event, key);
      },
      { initialProps: { event: view("Kaos"), key: "p1" } },
    );

    // A poll or a background refetch: a new event object, the same key.
    rerender({ event: view("Kaos"), key: "p1" });
    rerender({ event: view("Kaos"), key: "p1" });

    expect(sent()).toEqual(["Kaos"]);
  });

  it("sends again for another key (another product)", () => {
    const { rerender } = renderHook(
      ({ event, key }) => {
        useTrackOnce(event, key);
      },
      { initialProps: { event: view("Kaos"), key: "p1" } },
    );

    rerender({ event: view("Kemeja"), key: "p2" });

    expect(sent()).toEqual(["Kaos", "Kemeja"]);
  });

  it("sends nothing while the data is missing, and does not use up the key", () => {
    const { rerender } = renderHook<
      undefined,
      { event: EcommerceEvent | null; key?: string }
    >(
      ({ event, key }) => {
        useTrackOnce(event, key);
      },
      { initialProps: { event: null, key: "p1" } },
    );
    rerender({ event: view("Kaos"), key: undefined });
    expect(sent()).toEqual([]);

    rerender({ event: view("Kaos"), key: "p1" });

    expect(sent()).toEqual(["Kaos"]);
  });
});
