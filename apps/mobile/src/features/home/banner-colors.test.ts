import { describe, expect, it } from "@jest/globals";

import {
  FALLBACK_BANNER_COLOR,
  bannerBackground,
  bannerForeground,
} from "./banner-colors";

describe("bannerBackground", () => {
  it("keeps a #RRGGBB colour, upper or lower case", () => {
    expect(bannerBackground("#1E40AF")).toBe("#1E40AF");
    expect(bannerBackground("#1e40af")).toBe("#1e40af");
  });

  it.each(["", "red", "#fff", "#12345", "#1234567", "#GGGGGG", "1E40AF"])(
    "falls back to the primary colour for %p, so a bad colour cannot crash a card",
    (value) => {
      expect(bannerBackground(value)).toBe("#0b5cad");
      expect(FALLBACK_BANNER_COLOR).toBe("#0b5cad");
    },
  );
});

describe("bannerForeground", () => {
  it("is near-black on a light background", () => {
    expect(bannerForeground("#FFFF00")).toBe("#1f2328");
    expect(bannerForeground("#ffffff")).toBe("#1f2328");
  });

  it("is white on a dark background", () => {
    expect(bannerForeground("#1E40AF")).toBe("#ffffff");
    expect(bannerForeground("#000000")).toBe("#ffffff");
  });

  it("judges an invalid colour by the fallback (dark blue), so the text is white", () => {
    expect(bannerForeground("not-a-colour")).toBe("#ffffff");
  });
});
