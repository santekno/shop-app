import type { EcommerceEvent } from "@goshop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsEnabled, track } from "./analytics.ts";

const event: EcommerceEvent = {
  name: "view_item",
  params: {
    currency: "IDR",
    value: 89_000,
    items: [{ item_name: "Kaos Polos", price: 89_000, quantity: 1 }],
  },
};

afterEach(() => {
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("analyticsEnabled", () => {
  it("is false without Google's tag (GA_MEASUREMENT_ID unset)", () => {
    expect(analyticsEnabled()).toBe(false);
  });

  it("is true once the init script has defined gtag", () => {
    window.gtag = vi.fn();

    expect(analyticsEnabled()).toBe(true);
  });
});

describe("track", () => {
  it("hands the event to gtag as ('event', name, params)", () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    track(event);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("event", "view_item", event.params);
  });

  it("does nothing, and does not throw, without gtag", () => {
    expect(() => {
      track(event);
    }).not.toThrow();
    expect(window.dataLayer).toBeUndefined();
  });

  it("never throws, even when gtag does", () => {
    window.gtag = () => {
      throw new Error("gtag.js broke");
    };

    expect(() => {
      track(event);
    }).not.toThrow();
  });

  it("logs the event in development, so it can be checked without GA4", () => {
    vi.stubEnv("NODE_ENV", "development");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {
      // silenced
    });

    track(event);

    expect(debug).toHaveBeenCalledWith(
      "[analytics]",
      "view_item",
      event.params,
    );
  });

  it("logs nothing outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {
      // silenced
    });
    const gtag = vi.fn();
    window.gtag = gtag;

    track(event);

    expect(debug).not.toHaveBeenCalled();
    expect(gtag).toHaveBeenCalledTimes(1);
  });
});
