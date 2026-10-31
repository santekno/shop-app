import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { fonts } from "./fonts";

describe("fonts", () => {
  it("is one family, Inter, in the four weights the app uses", () => {
    expect(fonts.sans).toBe("Inter");
    expect(fonts.faces.map((face) => face.weight)).toEqual([
      400, 500, 600, 700,
    ]);
  });

  it.each(fonts.faces.map((face) => [face.weight, face.path] as const))(
    "embeds weight %s from a file that exists (%s)",
    (_weight, file) => {
      // Paths are relative to apps/mobile, where app.config.ts runs.
      expect(existsSync(path.resolve(__dirname, "../..", file))).toBe(true);
    },
  );

  it("ships the font's licence next to the files", () => {
    expect(
      existsSync(path.resolve(__dirname, "../../assets/fonts/OFL.txt")),
    ).toBe(true);
  });
});
