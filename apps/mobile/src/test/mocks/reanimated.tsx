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
import {
  createElement,
  forwardRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  // The lazy initialiser runs once, so the box keeps its identity.
  const [box] = useState<SharedValue<T>>(() => {
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
  });
  return box;
};

export const useAnimatedStyle = <T extends object>(worklet: () => T): T => {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return worklet();
};

// -- animations ----------------------------------------------------------

// The implementations take fewer parameters than the types declare: the
// extra ones (config, count, reverse) exist so a test can assert on them.
export const withTiming = jest.fn<<T>(to: T, config?: unknown) => T>(
  (to) => to,
);
export const withSpring = jest.fn<<T>(to: T, config?: unknown) => T>(
  (to) => to,
);
export const withRepeat = jest.fn<
  <T>(animation: T, count?: number, reverse?: boolean) => T
>((animation) => animation);
export const withSequence = jest.fn<<T>(...steps: T[]) => T>(
  (...steps) => steps[steps.length - 1] as (typeof steps)[number],
);
export const cancelAnimation = jest.fn<(value: unknown) => undefined>(
  () => undefined,
);

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
  /** The mode given to .reduceMotion(): "system", "always" or "never". */
  reduceMotionMode?: string;
}

/** A layout animation: its settings, and the builders that chain. */
interface LayoutAnimation extends LayoutAnimationSpec {
  duration: (ms: number) => LayoutAnimation;
  reduceMotion: (mode: string) => LayoutAnimation;
}

const layoutAnimation = (name: string): LayoutAnimation => {
  const make = (spec: LayoutAnimationSpec): LayoutAnimation => ({
    ...spec,
    duration: (durationMs) => make({ ...spec, durationMs }),
    reduceMotion: (reduceMotionMode) => make({ ...spec, reduceMotionMode }),
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
  forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    // A lazy require, for the reason above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reactNative = require("react-native") as Record<
      "View" | "Text",
      ComponentType<Record<string, unknown>>
    >;
    return createElement(reactNative[name], { ...props, ref });
  });

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
