import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import {
  PerfProfiler,
  countRender,
  getDurations,
  getProfiles,
  getRenderCounts,
  listLoadReporter,
  perfMark,
  perfMeasure,
  resetPerf,
} from "./perf";

let log: jest.SpiedFunction<typeof console.log>;

beforeEach(() => {
  resetPerf();
  log = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  resetPerf();
});

describe("perf, in development", () => {
  it("counts renders by name", () => {
    countRender("ProductCard");
    countRender("ProductCard");
    countRender("WishlistButton");

    expect(getRenderCounts()).toEqual({ ProductCard: 2, WishlistButton: 1 });
  });

  it("resetPerf starts a fresh measurement", () => {
    countRender("A");
    perfMark("m");
    perfMeasure("m");

    resetPerf();

    expect(getRenderCounts()).toEqual({});
    expect(getDurations()).toEqual({});
    expect(getProfiles()).toEqual({});
  });

  it("measures the time between a mark and a measure, logs it, and forgets the mark", () => {
    const now = jest.spyOn(performance, "now");
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1042.34);

    perfMark("load");
    const elapsed = perfMeasure("load");

    expect(elapsed).toBeCloseTo(42.34);
    expect(getDurations().load).toBeCloseTo(42.34);
    expect(log).toHaveBeenCalledWith("[perf] load: 42.3 ms");
    expect(perfMeasure("load")).toBeUndefined();
  });

  it("measuring something never marked gives undefined and records nothing", () => {
    expect(perfMeasure("nope")).toBeUndefined();
    expect(getDurations()).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });

  it("PerfProfiler shows its children and records the commit under its id", async () => {
    await render(
      <PerfProfiler id="catalog">
        <Text>isi</Text>
      </PerfProfiler>,
    );

    expect(screen.getByText("isi")).toBeTruthy();
    expect(getProfiles().catalog?.renders).toBeGreaterThanOrEqual(1);
    expect(getProfiles().catalog?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("listLoadReporter stores FlashList's own first-content time", () => {
    const report = listLoadReporter("katalog");

    report?.({ elapsedTimeInMs: 123.6 });

    expect(getDurations()["katalog:first-content"]).toBe(123.6);
    expect(log).toHaveBeenCalledWith(
      "[perf] katalog: first rows drawn after 124 ms",
    );
  });
});

describe("perf, in a release build", () => {
  beforeEach(() => {
    jest.replaceProperty(globalThis as { __DEV__: boolean }, "__DEV__", false);
  });

  it("counts, marks and measures nothing", () => {
    countRender("ProductCard");
    perfMark("load");

    expect(getRenderCounts()).toEqual({});
    expect(perfMeasure("load")).toBeUndefined();
    expect(getDurations()).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });

  it("hands FlashList no onLoad handler at all", () => {
    expect(listLoadReporter("katalog")).toBeUndefined();
  });

  it("PerfProfiler renders the children and does not profile", async () => {
    await render(
      <PerfProfiler id="catalog">
        <Text>isi</Text>
      </PerfProfiler>,
    );

    expect(screen.getByText("isi")).toBeTruthy();
    expect(getProfiles()).toEqual({});
  });
});
