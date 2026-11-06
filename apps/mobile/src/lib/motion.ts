// The app's small animations, in one place, so they feel alike and every
// one of them honours the device's "reduce motion" setting.
//
// How Reanimated 4 keeps them smooth: a shared value lives on the UI
// thread, and a function passed to useAnimatedStyle is a worklet, compiled
// to run there too. A spring or a timing started with withSpring /
// withTiming is stepped by the UI thread's frame callback. The JS thread
// is only involved to START it (an event handler writes `value = …`), so a
// busy JS thread (a big list rendering) does not make the heart stutter.
// No setInterval, no requestAnimationFrame loop, no setState per frame.
import { FadeIn, ReduceMotion } from "react-native-reanimated";

/**
 * A list item appearing for the first time: a short fade. A layout
 * animation (`entering`) is a description handed to the native side once,
 * with no per-row JavaScript. ReduceMotion.System makes it a plain
 * appearance when the device asks for less motion.
 *
 * It runs when a cell is MOUNTED. FlashList recycles cells, so a card
 * scrolled in from below re-renders an existing cell and does not fade;
 * only the first screenful and any cell the list has to create do. That is
 * the right amount: the first paint is not abrupt, and scrolling is never
 * slowed down by an animation per row.
 */
export const LIST_ITEM_ENTERING = FadeIn.duration(220).reduceMotion(
  ReduceMotion.System,
);

/** A card scales to this while a finger is down on it. */
export const PRESSED_SCALE = 0.97;
