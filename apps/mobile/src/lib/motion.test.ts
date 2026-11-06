import { describe, expect, it } from "@jest/globals";

import { LIST_ITEM_ENTERING, PRESSED_SCALE } from "./motion";

describe("the app's motion", () => {
  it("a list item fades in over 220 ms and follows the system's reduce-motion setting", () => {
    expect(LIST_ITEM_ENTERING).toMatchObject({
      name: "FadeIn",
      durationMs: 220,
      reduceMotionMode: "system",
    });
  });

  it("a pressed card shrinks to 97 percent", () => {
    expect(PRESSED_SCALE).toBe(0.97);
  });
});
