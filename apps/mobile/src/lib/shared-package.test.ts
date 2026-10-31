// @goshop/shared is TypeScript source with .ts imports, compiled by the
// app's own Babel (Metro in the app, babel-jest here). These cases check
// that what the web apps get from it, the app gets too.
import { describe, expect, it } from "@jest/globals";
import {
  buildCategoryTree,
  formatRupiah,
  loginSchema,
  registerSchema,
} from "@goshop/shared";

describe("@goshop/shared in the app", () => {
  it("validates a registration as on the web, counting code points", () => {
    const ok = registerSchema.safeParse({
      name: "  Budi  ",
      email: " budi@example.com ",
      password: "rahasia123",
    });
    expect(ok.success).toBe(true);
    expect(ok.data).toEqual({
      name: "Budi",
      email: "budi@example.com",
      password: "rahasia123",
    });

    // 100 emoji are 100 characters (200 UTF-16 units): allowed; 101 not.
    expect(
      registerSchema.safeParse({
        name: "😀".repeat(100),
        email: "b@example.com",
        password: "rahasia123",
      }).success,
    ).toBe(true);
    const tooLong = registerSchema.safeParse({
      name: "😀".repeat(101),
      email: "b@example.com",
      password: "rahasia123",
    });
    expect(tooLong.error?.issues[0]?.message).toBe(
      "Nama paling panjang 100 karakter.",
    );
  });

  it("gives the same Indonesian messages", () => {
    const result = loginSchema.safeParse({ email: " ", password: "" });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Masukkan email Anda.",
      "Masukkan kata sandi Anda.",
    ]);
  });

  it("formats rupiah and builds the category tree", () => {
    expect(formatRupiah({ amount: 1_250_000, currency: "IDR" })).toBe(
      "Rp 1.250.000",
    );
    expect(
      buildCategoryTree([
        { id: "1", slug: "pakaian", name: "Pakaian", parent_id: null },
        { id: "2", slug: "kaos", name: "Kaos", parent_id: "1" },
      ]).map((node) => node.children.map((child) => child.slug)),
    ).toEqual([["kaos"]]);
  });
});
