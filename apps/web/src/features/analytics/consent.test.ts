import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAnalyticsConsent,
  setAnalyticsConsent,
  useAnalyticsConsent,
} from "./consent.ts";
import { ANALYTICS_CONSENT_KEY } from "./gtag-init.ts";

const gtag = vi.fn();

/** What a SecurityError from a browser with site data blocked looks like. */
const blockStorage = (method: "getItem" | "setItem") =>
  vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });

/** The `storage` event another tab's answer sends this one. */
const answerInAnotherTab = (key: string, value: string) => {
  window.localStorage.setItem(key, value);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
};

beforeEach(() => {
  gtag.mockReset();
  window.gtag = gtag;
});

afterEach(() => {
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("readAnalyticsConsent", () => {
  it("is null before the buyer has answered", () => {
    expect(readAnalyticsConsent()).toBeNull();
  });

  it.each(["granted", "denied"] as const)("reads a stored %s", (answer) => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, answer);

    expect(readAnalyticsConsent()).toBe(answer);
  });

  it("treats anything else stored as no answer", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "yes");

    expect(readAnalyticsConsent()).toBeNull();
  });

  it("is null, not an error, when storage is blocked", () => {
    blockStorage("getItem");

    expect(readAnalyticsConsent()).toBeNull();
  });
});

describe("setAnalyticsConsent", () => {
  it.each(["granted", "denied"] as const)(
    "updates Consent Mode's analytics_storage only, and remembers %s",
    (answer) => {
      setAnalyticsConsent(answer);

      expect(gtag.mock.calls).toEqual([
        ["consent", "update", { analytics_storage: answer }],
      ]);
      expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe(answer);
    },
  );

  it("still applies the answer when it cannot be remembered", () => {
    blockStorage("setItem");

    expect(() => {
      setAnalyticsConsent("granted");
    }).not.toThrow();
    expect(gtag).toHaveBeenCalledWith("consent", "update", {
      analytics_storage: "granted",
    });
  });

  it("still remembers the answer when gtag throws", () => {
    gtag.mockImplementation(() => {
      throw new Error("gtag.js broke");
    });

    expect(() => {
      setAnalyticsConsent("denied");
    }).not.toThrow();
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
  });

  it("remembers the answer without Google's tag on the page", () => {
    delete window.gtag;

    setAnalyticsConsent("granted");

    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
  });
});

describe("useAnalyticsConsent", () => {
  it("is null in the browser before an answer, and follows setAnalyticsConsent", () => {
    const { result } = renderHook(() => useAnalyticsConsent());
    expect(result.current).toBeNull();

    act(() => {
      setAnalyticsConsent("granted");
    });

    expect(result.current).toBe("granted");
  });

  it("starts from the stored answer", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");

    const { result } = renderHook(() => useAnalyticsConsent());

    expect(result.current).toBe("denied");
  });

  it("takes another tab's answer, and applies it to gtag in this tab", () => {
    const { result } = renderHook(() => useAnalyticsConsent());

    answerInAnotherTab(ANALYTICS_CONSENT_KEY, "granted");

    expect(result.current).toBe("granted");
    expect(gtag).toHaveBeenCalledWith("consent", "update", {
      analytics_storage: "granted",
    });
  });

  it("applies nothing when another tab cleared the answer", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    const { result } = renderHook(() => useAnalyticsConsent());
    window.localStorage.removeItem(ANALYTICS_CONSENT_KEY);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ANALYTICS_CONSENT_KEY,
          newValue: null,
        }),
      );
    });

    expect(result.current).toBeNull();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("ignores another key's storage event", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    renderHook(() => useAnalyticsConsent());

    answerInAnotherTab("goshop:cart", "granted");

    expect(gtag).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useAnalyticsConsent());
    unmount();

    answerInAnotherTab(ANALYTICS_CONSENT_KEY, "granted");

    expect(gtag).not.toHaveBeenCalled();
  });
});
