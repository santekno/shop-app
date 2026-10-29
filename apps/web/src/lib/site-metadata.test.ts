import { describe, expect, it } from "vitest";
import { SITE_NAME, baseOpenGraph, summary } from "./site-metadata.ts";

describe("baseOpenGraph", () => {
  it("names the shop, in Indonesian, as a website", () => {
    expect(SITE_NAME).toBe("GoShop");
    expect(baseOpenGraph).toEqual({
      siteName: "GoShop",
      locale: "id_ID",
      type: "website",
    });
  });
});

describe("summary", () => {
  it("keeps a short text whole, its whitespace folded to single spaces", () => {
    expect(summary("  Kaos  polos\n\tkatun   combed. ")).toBe(
      "Kaos polos katun combed.",
    );
  });

  it("keeps a text of exactly the limit whole", () => {
    const text = "a".repeat(160);

    expect(summary(text)).toBe(text);
  });

  it("cuts a long text at the last whole word, with an ellipsis, within the limit", () => {
    const text = `${"kata ".repeat(40)}akhir`;

    const result = summary(text);

    expect(result).toBe(`${"kata ".repeat(30)}kata…`);
    expect(result.length).toBeLessThanOrEqual(160);
  });

  it("cuts mid-word when the last space is in the first half: a word that long is not dropped", () => {
    const text = `awal ${"x".repeat(200)}`;

    expect(summary(text, 20)).toBe(`awal ${"x".repeat(14)}…`);
  });

  it("honours a custom limit", () => {
    expect(summary("satu dua tiga empat lima", 12)).toBe("satu dua…");
  });
});
