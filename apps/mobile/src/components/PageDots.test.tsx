import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { PageDots } from "./PageDots";

const dots = () =>
  screen.container.queryAll(
    (i) =>
      typeof i.props.className === "string" &&
      (i.props.className as string).includes("rounded-full"),
  );

describe("PageDots", () => {
  it.each([0, 1])("draws nothing for %i page(s)", async (count) => {
    await render(<PageDots count={count} index={0} />);

    expect(dots()).toHaveLength(0);
  });

  it("draws one dot per page and makes only the current one long", async () => {
    await render(<PageDots count={4} index={2} />);

    const classes = dots().map((d) => d.props.className as string);
    expect(classes).toHaveLength(4);
    const long = classes.flatMap((c, i) => (c.includes("h-2 w-5") ? [i] : []));
    expect(long).toEqual([2]);
    expect(classes.filter((c) => c.includes("h-2 w-2"))).toHaveLength(3);
  });

  it("hides the dots from a screen reader", async () => {
    await render(<PageDots count={3} index={0} />);

    const [row] = screen.container.queryAll(
      (i) => i.props.accessibilityElementsHidden === true,
    );
    expect(row?.props.importantForAccessibility).toBe("no-hide-descendants");
  });
});
