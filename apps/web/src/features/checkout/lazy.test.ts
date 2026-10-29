import { describe, expect, it, vi } from "vitest";
import { loadCheckoutPage } from "./lazy.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

describe("loadCheckoutPage", () => {
  it("loads the module that exports CheckoutPage", async () => {
    const loaded = await loadCheckoutPage();
    expect(typeof loaded.CheckoutPage).toBe("function");
    expect(loaded.CheckoutPage.name).toBe("CheckoutPage");
  });
});
