// react-native-reanimated for the tests (jest.setup.ts mocks the module
// with this file). Reanimated's own `react-native-reanimated/mock` cannot
// load under Jest 30 here: it imports the real module first, which starts
// the native worklets runtime (loadUnpackersWithCode of undefined) and the
// web fallback needs react-native-web. So this is a hand-written stub of
// the small part of the API the app uses.
//
// What it keeps real, so a test can see the effect of the app's code:
//
// - a shared value is a `{ value }` box, and useAnimatedStyle re-reads its
//   worklet whenever ANY shared value changes (a version counter read with
//   useSyncExternalStore), so an assertion on the style a press produced
//   sees it;
// - withTiming / withSpring return their target at once (no frames), and
//   every animation helper is a jest.fn, so a test can assert what the app
//   asked for (withSequence(1.35, 1) for the heart's pop);
// - useReducedMotion answers what setReducedMotion (src/test/motion.ts)
//   says, false by default;
// - the layout animations (FadeIn, SlideInDown …) are plain descriptions
//   whose settings stay readable, and Animated.View keeps `entering` and
//   `exiting` as props.
import { jest } from "@jest/globals";
import { createElement, forwardRef, useRef, useSyncExternalStore } from "react";
import type { ComponentType } from "react";

import { onReset } from "./registry";

// -- shared values -------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getVersion = () => version;

interface SharedValue<T> {
  value: T;
}

export const useSharedValue = <T,>(initial: T): SharedValue<T> => {
  const box = useRef<SharedValue<T> | null>(null);
  box.current ??= (() => {
    let current = initial;
    return {
      get value() {
        return current;
      },
      set value(next: T) {
        if (Object.is(next, current)) return;
        current = next;
        version += 1;
        for (const listener of [...listeners]) listener();
      },
    };
  })();
  return box.current;
};

export const useAnimatedStyle = <T extends object>(worklet: () => T): T => {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return worklet();
};

// -- animations ----------------------------------------------------------

export const withTiming = jest.fn(<T,>(to: T, _config?: unknown) => to);
export const withSpring = jest.fn(<T,>(to: T, _config?: unknown) => to);
export const withRepeat = jest.fn(
  <T,>(animation: T, _count?: number, _reverse?: boolean) => animation,
);
export const withSequence = jest.fn(<T,>(...steps: T[]) => steps.at(-1) as T);
export const cancelAnimation = jest.fn((_value: unknown) => undefined);

// -- reduced motion ------------------------------------------------------

export const useReducedMotion = jest.fn(() => false);

export const ReduceMotion = {
  System: "system",
  Always: "always",
  Never: "never",
} as const;

// -- layout animations ---------------------------------------------------

/** What `FadeIn.duration(220).reduceMotion(...)` built, readable by a test. */
export interface LayoutAnimationSpec {
  name: string;
  durationMs?: number;
  reduceMotion?: string;
}

const layoutAnimation = (name: string) => {
  const make = (
    spec: LayoutAnimationSpec,
  ): LayoutAnimationSpec & {
    duration: (ms: number) => ReturnType<typeof make>;
    reduceMotion: (mode: string) => ReturnType<typeof make>;
  } => ({
    ...spec,
    duration: (durationMs) => make({ ...spec, durationMs }),
    reduceMotion: (reduceMotion) => make({ ...spec, reduceMotion }),
  });
  return make({ name });
};

export const FadeIn = layoutAnimation("FadeIn");
export const FadeOut = layoutAnimation("FadeOut");
export const SlideInDown = layoutAnimation("SlideInDown");

// -- components ----------------------------------------------------------

// react-native is required when a component renders, not when this file
// loads: jest.setup.ts imports this file for resetReanimatedMock, and
// loading react-native that early would hand the tests that isolate
// modules (src/lib/query-client.test.ts) a different AppState.
const animated = (name: "View" | "Text") =>
  forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    createElement(
      (require("react-native") as Record<string, ComponentType<unknown>>)[
        name
      ] as ComponentType<Record<string, unknown>>,
      { ...props, ref },
    ),
  );

const Animated = {
  View: animated("View"),
  Text: animated("Text"),
  createAnimatedComponent: (Component: ComponentType<never>) =>
    forwardRef<unknown, Record<string, unknown>>((props, ref) =>
      createElement(Component as ComponentType<Record<string, unknown>>, {
        ...props,
        ref,
      }),
    ),
};

export default Animated;

// Forgets the calls and the reduce-motion answer after every test.
onReset(() => {
  withTiming.mockClear();
  withSpring.mockClear();
  withRepeat.mockClear();
  withSequence.mockClear();
  cancelAnimation.mockClear();
  useReducedMotion.mockReset();
  useReducedMotion.mockReturnValue(false);
});
