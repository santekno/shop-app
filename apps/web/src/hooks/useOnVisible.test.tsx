import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnVisible } from "./useOnVisible.ts";

/** A stand-in IntersectionObserver the test drives by hand. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** Reports the observed element as (not) intersecting. */
  report(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const latest = () => {
  const observer = FakeObserver.instances.at(-1);
  if (!observer) throw new Error("no observer was created");
  return observer;
};

function Sentinel({
  onVisible,
  enabled,
  rootMargin,
}: {
  onVisible: () => void;
  enabled: boolean;
  rootMargin?: string;
}) {
  const ref = useOnVisible<HTMLDivElement>(onVisible, { enabled, rootMargin });
  return <div ref={ref} data-testid="sentinel" />;
}

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOnVisible", () => {
  it("watches the element with a 300px margin and calls onVisible when it shows", () => {
    const onVisible = vi.fn();
    const { getByTestId } = render(<Sentinel onVisible={onVisible} enabled />);

    expect(latest().observed).toEqual([getByTestId("sentinel")]);
    expect(latest().options).toEqual({ rootMargin: "300px" });
    latest().report(false);
    expect(onVisible).not.toHaveBeenCalled();
    latest().report(true);
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it("takes another rootMargin", () => {
    render(<Sentinel onVisible={vi.fn()} enabled rootMargin="0px" />);

    expect(latest().options).toEqual({ rootMargin: "0px" });
  });

  it("watches nothing while disabled, and checks again when enabled", () => {
    const onVisible = vi.fn();
    const { rerender } = render(
      <Sentinel onVisible={onVisible} enabled={false} />,
    );
    expect(FakeObserver.instances).toHaveLength(0);

    rerender(<Sentinel onVisible={onVisible} enabled />);
    expect(FakeObserver.instances).toHaveLength(1);

    rerender(<Sentinel onVisible={onVisible} enabled={false} />);
    expect(latest().disconnected).toBe(true);
    rerender(<Sentinel onVisible={onVisible} enabled />);
    expect(FakeObserver.instances).toHaveLength(2);
  });

  it("calls the latest onVisible without recreating the observer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Sentinel onVisible={first} enabled />);

    rerender(<Sentinel onVisible={second} enabled />);
    latest().report(true);

    expect(FakeObserver.instances).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("disconnects on unmount", () => {
    const { unmount } = render(<Sentinel onVisible={vi.fn()} enabled />);

    unmount();

    expect(latest().disconnected).toBe(true);
  });

  it("does nothing where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const onVisible = vi.fn();

    expect(() =>
      render(<Sentinel onVisible={onVisible} enabled />),
    ).not.toThrow();
    expect(onVisible).not.toHaveBeenCalled();
  });
});
