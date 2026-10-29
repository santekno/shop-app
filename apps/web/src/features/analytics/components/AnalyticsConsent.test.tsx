import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../gtag-init.ts";
import { AnalyticsConsent } from "./AnalyticsConsent.tsx";

const gtag = vi.fn();

/**
 * jsdom has no ResizeObserver and no layout: this one lets a test report
 * the banner's height, as a browser would after laying it out.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  target: HTMLElement | null = null;
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: HTMLElement) {
    this.target = target;
  }
  disconnect() {
    this.disconnected = true;
  }
  /** The banner is laid out `height` px tall. */
  resize(height: number) {
    if (this.target === null) throw new Error("nothing observed");
    Object.defineProperty(this.target, "offsetHeight", {
      configurable: true,
      value: height,
    });
    act(() => {
      this.callback();
    });
  }
}

const banner = () =>
  screen.queryByRole("region", { name: "Izinkan analytics?" });
const settings = () =>
  screen.getByRole("button", { name: "Pengaturan analytics" });
const spacer = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('div[aria-hidden="true"]');
const consentUpdates = () =>
  gtag.mock.calls
    .filter(([command]) => command === "consent")
    .map(([, , params]) => params as unknown);

beforeEach(() => {
  gtag.mockReset();
  window.gtag = gtag;
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("AnalyticsConsent", () => {
  it("asks a buyer who has not answered, without taking the focus", () => {
    render(<AnalyticsConsent />);

    expect(banner()).toBeTruthy();
    expect(
      screen.getByText(/Bila ditolak, tidak ada cookie analytics/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Izinkan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tolak" })).toBeTruthy();
    // Not opened by the buyer: no "Tutup", no current answer.
    expect(screen.queryByRole("button", { name: "Tutup" })).toBeNull();
    expect(screen.queryByText(/Pilihan Anda sekarang/)).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(settings().getAttribute("aria-expanded")).toBe("true");
    expect(settings().getAttribute("aria-controls")).toBe(banner()?.id);
  });

  it("Izinkan grants analytics_storage, remembers it, and hides the banner", async () => {
    const user = userEvent.setup();
    render(<AnalyticsConsent />);

    await user.click(screen.getByRole("button", { name: "Izinkan" }));

    expect(consentUpdates()).toEqual([{ analytics_storage: "granted" }]);
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
    expect(banner()).toBeNull();
    expect(settings().getAttribute("aria-expanded")).toBe("false");
    expect(settings().hasAttribute("aria-controls")).toBe(false);
  });

  it("Tolak denies analytics_storage and remembers it", async () => {
    const user = userEvent.setup();
    render(<AnalyticsConsent />);

    await user.click(screen.getByRole("button", { name: "Tolak" }));

    expect(consentUpdates()).toEqual([{ analytics_storage: "denied" }]);
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
    expect(banner()).toBeNull();
  });

  it("does not ask a buyer who answered before", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
    render(<AnalyticsConsent />);

    expect(banner()).toBeNull();
    expect(settings()).toBeTruthy();
  });

  it("asks on every visit while storage is blocked, and the answer still applies", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<AnalyticsConsent />);

    await user.click(screen.getByRole("button", { name: "Izinkan" }));

    expect(consentUpdates()).toEqual([{ analytics_storage: "granted" }]);
    // Nothing could be read back: the banner stays, as the next visit's would.
    expect(banner()).toBeTruthy();
  });

  it("Pengaturan analytics reopens it with the focus and the current answer", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    render(<AnalyticsConsent />);

    await user.click(settings());

    expect(banner()).toBeTruthy();
    expect(document.activeElement).toBe(banner());
    expect(screen.getByText("Pilihan Anda sekarang: diizinkan.")).toBeTruthy();
    expect(settings().getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a denied answer as ditolak, and changing it returns the focus", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
    render(<AnalyticsConsent />);
    await user.click(settings());
    expect(screen.getByText("Pilihan Anda sekarang: ditolak.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Izinkan" }));

    expect(consentUpdates()).toEqual([{ analytics_storage: "granted" }]);
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(settings());
  });

  it("Tutup closes it without changing the answer, focus back on the button", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    render(<AnalyticsConsent />);
    await user.click(settings());

    await user.click(screen.getByRole("button", { name: "Tutup" }));

    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(settings());
    expect(consentUpdates()).toEqual([]);
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
  });

  it("Escape closes the reopened banner", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
    render(<AnalyticsConsent />);
    await user.click(settings());

    await user.keyboard("{Escape}");

    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(settings());
  });

  it("Escape does not close a banner nobody has answered yet", async () => {
    const user = userEvent.setup();
    render(<AnalyticsConsent />);
    banner()?.focus();

    await user.keyboard("{Escape}");

    expect(banner()).toBeTruthy();
    // Nothing to close and nowhere to send the focus: it stays put.
    expect(document.activeElement).toBe(banner());
  });

  it("keeps the banner's measured height free under the page", () => {
    const { container } = render(<AnalyticsConsent />);
    expect(spacer(container)?.style.height).toBe("0px");
    const [observer] = FakeResizeObserver.instances;
    expect(observer?.target).toBe(banner());

    observer?.resize(189);

    expect(spacer(container)?.style.height).toBe("189px");
  });

  it("stops measuring, and removes the spacer, once answered", async () => {
    const user = userEvent.setup();
    const { container } = render(<AnalyticsConsent />);
    const [observer] = FakeResizeObserver.instances;

    await user.click(screen.getByRole("button", { name: "Tolak" }));

    expect(observer?.disconnected).toBe(true);
    expect(spacer(container)).toBeNull();
  });
});
