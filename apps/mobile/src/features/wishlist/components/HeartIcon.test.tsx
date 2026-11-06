import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { withSequence, withSpring } from "react-native-reanimated";

import { setReducedMotion } from "@/test/motion";
import { HeartIcon } from "./HeartIcon";

const scaleShown = () => {
  const [node] = screen.container.queryAll((n) => {
    const style = n.props.style as { transform?: unknown } | undefined;
    return Array.isArray(style?.transform);
  });
  const style = node?.props.style as { transform: { scale: number }[] };
  return style.transform[0]?.scale;
};

describe("HeartIcon", () => {
  it("a card that shows up already saved does not pop", async () => {
    await render(<HeartIcon saved />);

    expect(withSpring).not.toHaveBeenCalled();
    expect(scaleShown()).toBe(1);
  });

  it("pops out to 1.35 and back with a spring when it becomes saved", async () => {
    const { rerender } = await render(<HeartIcon saved={false} />);

    await rerender(<HeartIcon saved />);

    expect(withSpring).toHaveBeenNthCalledWith(1, 1.35, {
      damping: 9,
      stiffness: 260,
      mass: 0.6,
    });
    expect(withSpring).toHaveBeenNthCalledWith(2, 1, {
      damping: 9,
      stiffness: 260,
      mass: 0.6,
    });
    expect(withSequence).toHaveBeenCalledTimes(1);
  });

  it("removing it does not pop", async () => {
    const { rerender } = await render(<HeartIcon saved />);

    await rerender(<HeartIcon saved={false} />);

    expect(withSequence).not.toHaveBeenCalled();
  });

  it("re-rendering with the same state does not pop again", async () => {
    const { rerender } = await render(<HeartIcon saved={false} />);
    await rerender(<HeartIcon saved />);
    await rerender(<HeartIcon saved size={30} />);

    expect(withSequence).toHaveBeenCalledTimes(1);
  });

  it("with reduce motion on, saving moves nothing", async () => {
    setReducedMotion(true);
    const { rerender } = await render(<HeartIcon saved={false} />);

    await rerender(<HeartIcon saved />);

    expect(withSequence).not.toHaveBeenCalled();
    expect(withSpring).not.toHaveBeenCalled();
    expect(scaleShown()).toBe(1);
  });
});
