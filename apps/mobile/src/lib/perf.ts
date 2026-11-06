// A dev-only measuring kit for lists (artikel 14). Everything here is a
// no-op in a release build: `__DEV__` is false there, Metro strips the
// branches, and <PerfProfiler> renders its children and nothing else.
//
// What it answers, and what it does not:
//
//   - how many times did a component render? (`countRender`)
//   - how long did React spend rendering a subtree, and how often?
//     (<PerfProfiler>, React's own <Profiler>)
//   - how long from "the screen asked for data" to "the list drew rows"?
//     (`perfMark` + FlashList's onLoad, `listLoadReporter`)
//
// It does NOT measure frames per second or UI-thread time. For that use
// the platform's tools (Android Studio profiler / `adb shell dumpsys
// gfxinfo`, Xcode Instruments) on a release build, never a dev one: a dev
// build is several times slower and says nothing about what a buyer gets.
import { createElement, Fragment, Profiler } from "react";
import type { ProfilerOnRenderCallback, ReactNode } from "react";

interface RenderStat {
  /** Commits that included this component. */
  renders: number;
  /** Sum of React's `actualDuration` for those commits, in ms. */
  totalMs: number;
}

const renderCounts = new Map<string, number>();
const profiles = new Map<string, RenderStat>();
const marks = new Map<string, number>();
const durations = new Map<string, number>();

/**
 * Call it in a component's body: `countRender("ProductCard")`. One call is
 * one render of that component (a re-render for any reason counts, and so
 * does React StrictMode's second dev render).
 */
export function countRender(name: string): void {
  if (!__DEV__) return;
  renderCounts.set(name, (renderCounts.get(name) ?? 0) + 1);
}

/** The renders counted so far, by name. */
export const getRenderCounts = (): Record<string, number> =>
  Object.fromEntries(renderCounts);

const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  const before = profiles.get(id) ?? { renders: 0, totalMs: 0 };
  profiles.set(id, {
    renders: before.renders + 1,
    totalMs: before.totalMs + actualDuration,
  });
};

/** What <PerfProfiler> recorded, by id. */
export const getProfiles = (): Record<string, RenderStat> =>
  Object.fromEntries(profiles);

/**
 * Wraps a subtree in React's Profiler in development, and does nothing
 * (just the children) in a release build.
 */
export function PerfProfiler({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  // createElement, not JSX, so this file stays a plain .ts as the
  // curriculum names it.
  if (!__DEV__) return createElement(Fragment, null, children);
  return createElement(Profiler, { id, onRender }, children);
}

/** Starts a stopwatch under `name` (performance.now(), in ms). */
export function perfMark(name: string): void {
  if (!__DEV__) return;
  marks.set(name, performance.now());
}

/**
 * Ends the stopwatch `name` and remembers how long it ran. Logs one line
 * in development. Returns the elapsed ms, or undefined when there was no
 * mark.
 */
export function perfMeasure(name: string): number | undefined {
  if (!__DEV__) return undefined;
  const start = marks.get(name);
  if (start === undefined) return undefined;
  const elapsed = performance.now() - start;
  durations.set(name, elapsed);
  marks.delete(name);
  console.log(`[perf] ${name}: ${elapsed.toFixed(1)} ms`);
  return elapsed;
}

/** The stopwatches that have ended, by name, in ms. */
export const getDurations = (): Record<string, number> =>
  Object.fromEntries(durations);

/**
 * FlashList's `onLoad`: raised once the list has drawn its first rows (or
 * its empty component), with the time FlashList itself measured. The
 * number of "time to first content" for a list. Pass the result straight
 * to the prop: `onLoad={listLoadReporter("catalog")}`. In a release build
 * it is `undefined`, so the list gets no handler at all.
 */
export const listLoadReporter = (
  name: string,
): ((info: { elapsedTimeInMs: number }) => void) | undefined => {
  if (!__DEV__) return undefined;
  return ({ elapsedTimeInMs }) => {
    durations.set(`${name}:first-content`, elapsedTimeInMs);
    console.log(
      `[perf] ${name}: first rows drawn after ${elapsedTimeInMs.toFixed(0)} ms`,
    );
  };
};

/** Clears every counter, for a fresh measurement. */
export function resetPerf(): void {
  renderCounts.clear();
  profiles.clear();
  marks.clear();
  durations.clear();
}
