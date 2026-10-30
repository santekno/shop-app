// jsdom lays nothing out, so Recharts' responsive container measures
// 0 × 0 and draws nothing (vitest.setup.ts's ResizeObserver never
// reports). This one reports the size CSS gives a chart in the browser,
// once, when observing starts, so the axes and bars are drawn:
//
//   stubSizedResizeObserver();   // for this test (unstubGlobals)
import { vi } from "vitest";

export const stubSizedResizeObserver = (width = 640, height = 256) => {
  class SizedResizeObserver {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: { width, height },
          } as unknown as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve() {
      // Nothing is watched after the first report.
    }
    disconnect() {
      // See unobserve().
    }
  }
  vi.stubGlobal("ResizeObserver", SizedResizeObserver);
};
