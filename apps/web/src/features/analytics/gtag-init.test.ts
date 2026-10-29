import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_CONSENT_KEY,
  gtagInitScript,
  gtagScriptUrl,
} from "./gtag-init.ts";

const ID = "G-TEST123456";

/**
 * Runs the inline script as the browser would in <head>, and returns what
 * it queued for gtag.js: each `dataLayer` entry as a plain array.
 */
const runInitScript = (measurementId = ID): unknown[][] => {
  // The script is a string the root layout prints into the page; running
  // it is the only way to see what it does.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const script = new Function(gtagInitScript(measurementId)) as () => void;
  script();
  return (window.dataLayer ?? []).map((entry) =>
    Array.from(entry as ArrayLike<unknown>),
  );
};

const DENIED_ADS = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
};

afterEach(() => {
  delete window.dataLayer;
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("gtagScriptUrl", () => {
  it("loads gtag.js for the measurement ID", () => {
    expect(gtagScriptUrl(ID)).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-TEST123456",
    );
  });

  it("escapes the ID as a query value", () => {
    expect(gtagScriptUrl("G-A&B")).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-A%26B",
    );
  });
});

describe("gtagInitScript", () => {
  it("queues consent default (all denied) before js and config for a first visit", () => {
    const queue = runInitScript();

    expect(queue.map((entry) => entry[0])).toEqual(["consent", "js", "config"]);
    expect(queue[0]).toEqual([
      "consent",
      "default",
      { ...DENIED_ADS, analytics_storage: "denied" },
    ]);
    expect(queue[1]?.[1]).toBeInstanceOf(Date);
    expect(queue[2]).toEqual(["config", ID]);
  });

  it("defines window.gtag, which queues onto dataLayer", () => {
    runInitScript();
    window.gtag?.("event", "view_item", { value: 1 });

    const last = window.dataLayer?.at(-1);
    expect(Array.from(last as ArrayLike<unknown>)).toEqual([
      "event",
      "view_item",
      { value: 1 },
    ]);
  });

  it("makes a stored 'granted' the default, so the first hit has a cookie", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");

    expect(runInitScript()[0]).toEqual([
      "consent",
      "default",
      { ...DENIED_ADS, analytics_storage: "granted" },
    ]);
  });

  it.each(["denied", "yes", ""])(
    "keeps analytics denied for a stored %j",
    (stored) => {
      window.localStorage.setItem(ANALYTICS_CONSENT_KEY, stored);

      expect(runInitScript()[0]?.[2]).toEqual({
        ...DENIED_ADS,
        analytics_storage: "denied",
      });
    },
  );

  it("keeps analytics denied, and still starts the tag, when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const queue = runInitScript();

    expect(queue[0]?.[2]).toEqual({
      ...DENIED_ADS,
      analytics_storage: "denied",
    });
    expect(queue[2]).toEqual(["config", ID]);
  });

  it("keeps an existing dataLayer, appending to it", () => {
    window.dataLayer = [["earlier"]];

    const queue = runInitScript();

    expect(queue[0]).toEqual(["earlier"]);
    expect(queue[1]?.[0]).toBe("consent");
  });

  it("writes the ID as a string literal: nothing in it can end the script", () => {
    const script = gtagInitScript("G-X');alert(1);//");

    expect(script).toContain(`gtag('config',"G-X');alert(1);//");`);
    expect(runInitScript("G-X');alert(1);//").at(-1)).toEqual([
      "config",
      "G-X');alert(1);//",
    ]);
  });
});
