import { describe, expect, it, vi } from "vitest";
import { loadCheckoutPage } from "./lazy.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

describe("loadCheckoutPage", () => {
  it("loads the module that exports CheckoutPage", async () => {
    const module = await loadCheckoutPage();
    expect(typeof module.CheckoutPage).toBe("function");
    expect(module.CheckoutPage.name).toBe("CheckoutPage");
  });
});
