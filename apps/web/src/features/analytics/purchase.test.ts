import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { order } from "@/test/checkout-fixtures.ts";
import {
  TRACKED_PURCHASES_KEY,
  TRACKED_PURCHASES_LIMIT,
  trackPurchaseOnce,
} from "./purchase.ts";

// trackPurchaseOnce also remembers in the module (blocked storage), for
// the life of the page, so every test uses codes of its own.
const gtag = vi.fn();

/** The transaction_id of every purchase sent to gtag. */
const purchases = () =>
  gtag.mock.calls
    .filter(([, name]) => name === "purchase")
    .map(
      ([, , params]) => (params as { transaction_id: string }).transaction_id,
    );

const stored = (): unknown =>
  JSON.parse(window.localStorage.getItem(TRACKED_PURCHASES_KEY) ?? "null");

beforeEach(() => {
  gtag.mockReset();
  window.gtag = gtag;
});

afterEach(() => {
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("trackPurchaseOnce", () => {
  it("sends purchase with the order's code, total and shipping, and remembers the code", () => {
    trackPurchaseOnce(order({ code: "GS-A1" }));

    expect(gtag).toHaveBeenCalledWith(
      "event",
      "purchase",
      expect.objectContaining({
        transaction_id: "GS-A1",
        value: 107_000,
        shipping: 18_000,
        currency: "IDR",
      }),
    );
    expect(stored()).toEqual(["GS-A1"]);
  });

  it("sends nothing the second time the same order is seen", () => {
    trackPurchaseOnce(order({ code: "GS-A2" }));
    trackPurchaseOnce(order({ code: "GS-A2" }));

    expect(purchases()).toEqual(["GS-A2"]);
  });

  it("sends nothing for an order reported before this page (a reload)", () => {
    window.localStorage.setItem(
      TRACKED_PURCHASES_KEY,
      JSON.stringify(["GS-OLD", "GS-A3"]),
    );

    trackPurchaseOnce(order({ code: "GS-A3" }));

    expect(purchases()).toEqual([]);
    expect(stored()).toEqual(["GS-OLD", "GS-A3"]);
  });

  it("keeps only the last TRACKED_PURCHASES_LIMIT codes", () => {
    const earlier = Array.from(
      { length: TRACKED_PURCHASES_LIMIT },
      (_, i) => `GS-CAP-${String(i)}`,
    );
    window.localStorage.setItem(TRACKED_PURCHASES_KEY, JSON.stringify(earlier));

    trackPurchaseOnce(order({ code: "GS-CAP-NEW" }));

    expect(TRACKED_PURCHASES_LIMIT).toBe(20);
    expect(purchases()).toEqual(["GS-CAP-NEW"]);
    expect(stored()).toEqual([...earlier.slice(1), "GS-CAP-NEW"]);
  });

  it.each([
    ["not JSON", "{", "GS-A4"],
    ["not a list", JSON.stringify({ code: "GS-A4B" }), "GS-A4B"],
  ])("starts again from an unreadable list (%s)", (_, value, code) => {
    window.localStorage.setItem(TRACKED_PURCHASES_KEY, value);

    trackPurchaseOnce(order({ code }));

    expect(purchases()).toEqual([code]);
    expect(stored()).toEqual([code]);
  });

  it("drops entries of the list that are not codes", () => {
    window.localStorage.setItem(
      TRACKED_PURCHASES_KEY,
      JSON.stringify([1, null, "GS-KEEP"]),
    );

    trackPurchaseOnce(order({ code: "GS-A5" }));

    expect(stored()).toEqual(["GS-KEEP", "GS-A5"]);
  });

  it("sends once per page when storage is blocked, without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => {
      trackPurchaseOnce(order({ code: "GS-A6" }));
      trackPurchaseOnce(order({ code: "GS-A6" }));
    }).not.toThrow();

    expect(purchases()).toEqual(["GS-A6"]);
  });

  it("remembers nothing without GA_MEASUREMENT_ID", () => {
    delete window.gtag;

    trackPurchaseOnce(order({ code: "GS-A7" }));

    expect(window.localStorage.getItem(TRACKED_PURCHASES_KEY)).toBeNull();
    // Turned on later in the same page, the order still counts once.
    window.gtag = gtag;
    trackPurchaseOnce(order({ code: "GS-A7" }));
    expect(purchases()).toEqual(["GS-A7"]);
  });
});
