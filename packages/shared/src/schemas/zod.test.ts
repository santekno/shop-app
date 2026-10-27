import { z as zod } from "zod";
import { describe, expect, it } from "vitest";
import { registerSchema } from "../index.ts";
import { z } from "./zod.ts";

describe("the shared Zod setup", () => {
  it("turns jitless on once the package's schemas are loaded", () => {
    expect(registerSchema.safeParse({}).success).toBe(false);
    expect(zod.config().jitless).toBe(true);
  });

  it("re-exports the one Zod instance it configured", () => {
    expect(z).toBe(zod);
  });
});
