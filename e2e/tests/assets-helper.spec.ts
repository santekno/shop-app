// A unit check of support/assets.ts (no browser): chunk names must survive
// hashes that contain "-", or the chunk specs fail at random as the content
// hash changes.
import { expect, test } from "@playwright/test";
import { chunkName } from "../support/assets.ts";

test("chunkName cuts exactly the 8-character hash off a Vite chunk", () => {
  const cases: [string, string | undefined][] = [
    ["/assets/index-B4Uz40Tu.js", "index"],
    ["/assets/index-D-d-RXfr.js", "index"],
    ["/assets/LoginPage-Ab-cd123.js", "LoginPage"],
    ["/assets/ProductDetailPage--abcdefg.js", "ProductDetailPage"],
    ["/assets/navigation-state-DHg4MFGA.js", "navigation-state"],
    ["/assets/navigation-state-a-b-c-d-.js", "navigation-state"],
    ["/assets/index-BuHJtCnL.css", undefined],
    ["/assets/index-short.js", undefined],
    ["/src/main.tsx", undefined],
  ];
  for (const [pathname, name] of cases) {
    expect(chunkName(pathname), pathname).toBe(name);
  }
});
