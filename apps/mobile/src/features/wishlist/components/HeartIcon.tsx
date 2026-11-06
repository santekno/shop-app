import { useEffect, useRef } from "react";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";

import { Icon } from "@/components/Icon";

/** The pop: out to this scale, then back to 1. */
const POP_SCALE = 1.35;
const SPRING = { damping: 9, stiffness: 260, mass: 0.6 } as const;

interface HeartIconProps {
  saved: boolean;
  size?: number;
}

/**
 * The heart, popping when it is SAVED (a spring out and back). Removing it
 * just empties it: a celebration for taking something away would be odd.
 *
 * The scale is a shared value, changed by the effect when `saved` flips
 * and read by the animated style, which is a worklet on the UI thread:
 * the spring does not touch JavaScript after it starts. The first render
 * does not pop (a card that shows up already saved is not news). With
 * "reduce motion" on, nothing moves; the fill changing is the feedback.
 */
export function HeartIcon({ saved, size = 20 }: HeartIconProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const wasSaved = useRef(saved);

  useEffect(() => {
    const before = wasSaved.current;
    wasSaved.current = saved;
    if (reduceMotion || before === saved || !saved) return;
    scale.value = withSequence(
      withSpring(POP_SCALE, SPRING),
      withSpring(1, SPRING),
    );
  }, [saved, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={style}>
      <Icon
        name="wishlist"
        size={size}
        solid={saved}
        className={
          saved
            ? "text-destructive dark:text-destructive-dark"
            : "text-muted-foreground dark:text-muted-foreground-dark"
        }
      />
    </Animated.View>
  );
}
