// Loading placeholders: grey shapes where the content will be, pulsing
// slowly. A spinner says "something is coming"; a skeleton also says what
// shape it has, so the screen does not jump when the data arrives and the
// first paint already looks like the screen.
//
// One animation per group, not per block: the group's wrapper pulses its
// opacity and every Skeleton inside is a plain View. Thirty shapes with
// thirty animations would cost the UI thread for nothing.
import { useEffect } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/** Half a pulse, in ms: from full to faint, then back. */
const PULSE_MS = 800;
/** The faintest the shapes get. */
const PULSE_LOW = 0.45;

interface SkeletonGroupProps {
  /**
   * What is loading, in words: "Memuat produk…". The group is one element
   * for a screen reader (a progressbar with this label), and the shapes
   * inside are hidden from it, as a spinner's label was.
   */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps skeleton shapes: pulses them together and announces `label`.
 *
 * With "reduce motion" on (an accessibility setting of both platforms,
 * read by useReducedMotion) the shapes stay still at one opacity: a
 * pulse is motion, and for some people motion is a problem.
 */
export function SkeletonGroup({
  label,
  className,
  children,
}: SkeletonGroupProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.7;
      return;
    }
    opacity.value = withRepeat(
      withTiming(PULSE_LOW, { duration: PULSE_MS }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [reduceMotion, opacity]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      importantForAccessibility="yes"
      style={pulse}
      className={className}
    >
      {children}
    </Animated.View>
  );
}

interface SkeletonProps {
  /** The shape's size and margins: `h-4 w-1/2`, `aspect-square w-full`. */
  className?: string;
  /** For a size that is a number measured at run time. */
  style?: StyleProp<ViewStyle>;
}

/** One grey shape. Put it inside a SkeletonGroup, which labels and pulses it. */
export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
      className={`rounded-md bg-border/60 dark:bg-border-dark/60 ${className}`}
    />
  );
}
