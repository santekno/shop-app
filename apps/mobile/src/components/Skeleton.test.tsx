import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import {
  cancelAnimation,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { setReducedMotion } from "@/test/motion";
import { Skeleton, SkeletonGroup } from "./Skeleton";

const opacityOf = () => {
  const group = screen.getByRole("progressbar");
  const style = group.props.style as { opacity?: number } | undefined;
  return style?.opacity;
};

describe("SkeletonGroup", () => {
  it("is one busy progressbar named by its label", async () => {
    await render(
      <SkeletonGroup label="Memuat produk…">
        <Skeleton className="h-4 w-full" />
      </SkeletonGroup>,
    );

    const group = screen.getByRole("progressbar", { name: "Memuat produk…" });
    expect(group).toHaveProp("accessibilityState", { busy: true });
  });

  it("pulses forever between full and 0.45 opacity, 800 ms each way", async () => {
    await render(
      <SkeletonGroup label="Memuat">
        <Skeleton />
      </SkeletonGroup>,
    );

    expect(withTiming).toHaveBeenCalledWith(0.45, { duration: 800 });
    expect(withRepeat).toHaveBeenCalledWith(0.45, -1, true);
    expect(opacityOf()).toBe(0.45);
  });

  it("stops the animation when it goes away", async () => {
    const { unmount } = await render(
      <SkeletonGroup label="Memuat">
        <Skeleton />
      </SkeletonGroup>,
    );

    await unmount();

    expect(cancelAnimation).toHaveBeenCalledTimes(1);
  });

  it("with reduce motion on, stays still at 0.7 and starts no animation", async () => {
    setReducedMotion(true);
    await render(
      <SkeletonGroup label="Memuat">
        <Skeleton />
      </SkeletonGroup>,
    );

    expect(withRepeat).not.toHaveBeenCalled();
    expect(withTiming).not.toHaveBeenCalled();
    expect(opacityOf()).toBe(0.7);
  });
});

describe("Skeleton", () => {
  it("is a grey shape hidden from screen readers that takes the caller's size", async () => {
    await render(
      <SkeletonGroup label="Memuat">
        <Skeleton className="h-4 w-1/2" style={{ marginTop: 3 }} />
        <Text>x</Text>
      </SkeletonGroup>,
    );

    const [shape] = screen.container.queryAll(
      (i) =>
        typeof i.props.className === "string" &&
        i.props.className.includes("h-4 w-1/2"),
    );
    expect(shape?.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(shape?.props.accessibilityElementsHidden).toBe(true);
    expect(shape?.props.className).toContain("rounded-md");
  });
});
