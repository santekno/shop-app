import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { LoginRequest, RegisterRequest } from "../api/types.ts";
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginSchema,
  registerSchema,
} from "./auth.ts";

const valid = {
  name: "Budi",
  email: "budi@example.com",
  password: "rahasia123",
};

/** The messages of every issue on `field`, or [] when it is valid. */
const errorsOf = (
  schema: typeof registerSchema | typeof loginSchema,
  value: Record<string, string>,
  field: string,
) => {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
};

const registerErrors = (field: keyof typeof valid, value: string) =>
  errorsOf(registerSchema, { ...valid, [field]: value }, field);

describe("the schemas' types", () => {
  it("make registerSchema's output exactly the contract's RegisterRequest", () => {
    expectTypeOf<
      z.output<typeof registerSchema>
    >().toEqualTypeOf<RegisterRequest>();
  });

  it("make loginSchema's output exactly the contract's LoginRequest", () => {
    expectTypeOf<z.output<typeof loginSchema>>().toEqualTypeOf<LoginRequest>();
  });
});

describe("the limits", () => {
  it("are the API's", () => {
    expect([
      PASSWORD_MIN_LENGTH,
      PASSWORD_MAX_LENGTH,
      EMAIL_MAX_LENGTH,
      NAME_MAX_LENGTH,
    ]).toEqual([8, 128, 254, 100]);
  });
});

describe("registerSchema", () => {
  it("accepts a valid account and outputs the trimmed name and email", () => {
    expect(
      registerSchema.parse({
        name: "  Budi Santoso ",
        email: " budi@example.com\t",
        password: " rahasia123 ",
      }),
    ).toEqual({
      name: "Budi Santoso",
      email: "budi@example.com",
      // Spaces are part of a password: never trimmed.
      password: " rahasia123 ",
    });
  });

  describe("email", () => {
    it.each([
      "budi@example.com",
      "Budi.Santoso+toko@mail.example.co.id",
      "a!#$%&'*+/=?^_`{|}~-@example.com",
      "x@a-b.example.org",
      "x@example.c0m",
    ])("accepts %s", (email) => {
      expect(registerErrors("email", email)).toEqual([]);
    });

    // A form shows a field's first issue, so that is the one that counts.
    it("asks for an email first when it is empty or only spaces", () => {
      expect(registerErrors("email", "")[0]).toBe("Masukkan email Anda.");
      expect(registerErrors("email", "   ")[0]).toBe("Masukkan email Anda.");
    });

    it.each([
      ["no @", "budi.example.com"],
      ["no domain dot", "budi@localhost"],
      ["a leading dot", ".budi@example.com"],
      ["a trailing dot before @", "budi.@example.com"],
      ["a double dot", "bu..di@example.com"],
      ["a label starting with a hyphen", "budi@-example.com"],
      ["a label ending with a hyphen", "budi@example-.com"],
      ["a TLD ending with a digit", "budi@example.c0"],
      ["a TLD starting with a digit", "budi@example.0com"],
      ["a space inside", "bu di@example.com"],
      ["a quoted local part", '"bu di"@example.com'],
      ["two @", "budi@@example.com"],
      ["non-ASCII letters", "büdi@example.com"],
      ["a non-ASCII domain", "budi@exämple.com"],
    ])("refuses %s", (_, email) => {
      expect(registerErrors("email", email)).toEqual([
        "Masukkan alamat email yang benar, misalnya budi@example.com.",
      ]);
    });

    it("allows 254 characters and refuses 255", () => {
      const at254 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
      expect(at254).toHaveLength(254);
      expect(registerErrors("email", at254)).toEqual([]);

      const at255 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
      expect(registerErrors("email", at255)).toContain(
        "Email paling panjang 254 karakter.",
      );
    });

    it("counts the length after trimming", () => {
      const at254 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
      expect(registerErrors("email", `  ${at254}  `)).toEqual([]);
    });
  });

  describe("password", () => {
    it("asks for a password first when it is empty", () => {
      expect(registerErrors("password", "")[0]).toBe("Buat kata sandi.");
    });

    // Named with $label and $verdict: a positional "%s" would print the
    // password itself in the place of the verdict.
    it.each([
      { label: "7 characters", password: "a".repeat(7), verdict: "refused" },
      { label: "8 characters", password: "a".repeat(8), verdict: "accepted" },
      {
        label: "128 characters",
        password: "a".repeat(128),
        verdict: "accepted",
      },
      {
        label: "129 characters",
        password: "a".repeat(129),
        verdict: "refused",
      },
      // Code points, as Go counts runes: 8 emoji are 16 UTF-16 units.
      { label: "8 emoji", password: "🔑".repeat(8), verdict: "accepted" },
      {
        label: "7 emoji (14 UTF-16 units)",
        password: "🔑".repeat(7),
        verdict: "refused",
      },
      {
        label: "128 emoji (256 UTF-16 units)",
        password: "🔑".repeat(128),
        verdict: "accepted",
      },
      { label: "129 emoji", password: "🔑".repeat(129), verdict: "refused" },
    ] as const)("$label: $verdict", ({ password, verdict }) => {
      expect(registerErrors("password", password)).toEqual(
        verdict === "accepted"
          ? []
          : ["Kata sandi harus 8 sampai 128 karakter."],
      );
    });

    it("refuses a password of only spaces", () => {
      expect(registerErrors("password", " ".repeat(10))).toEqual([
        "Kata sandi tidak boleh hanya berisi spasi.",
      ]);
    });

    it("accepts spaces inside and around a password", () => {
      expect(registerErrors("password", " kata sandi ")).toEqual([]);
    });
  });

  describe("name", () => {
    it("asks for a name when it is empty or only spaces", () => {
      expect(registerErrors("name", "")).toEqual(["Masukkan nama Anda."]);
      expect(registerErrors("name", "  ")).toEqual(["Masukkan nama Anda."]);
    });

    it("allows 100 characters, counted as code points, and refuses 101", () => {
      expect(registerErrors("name", "a".repeat(100))).toEqual([]);
      expect(registerErrors("name", "😀".repeat(100))).toEqual([]);
      expect(registerErrors("name", "a".repeat(101))).toEqual([
        "Nama paling panjang 100 karakter.",
      ]);
      expect(registerErrors("name", `  ${"a".repeat(100)}  `)).toEqual([]);
    });

    it("refuses a NUL character", () => {
      expect(registerErrors("name", "Bu\u0000di")).toEqual([
        "Nama berisi karakter yang tidak didukung.",
      ]);
    });

    it("accepts names in any script", () => {
      expect(registerErrors("name", "Siti Nurhaliza 李")).toEqual([]);
    });
  });
});

describe("loginSchema", () => {
  const login = { email: "budi@example.com", password: "x" };
  const loginErrors = (field: "email" | "password", value: string) =>
    errorsOf(loginSchema, { ...login, [field]: value }, field);

  it("accepts any present email and password and trims only the email", () => {
    expect(
      loginSchema.parse({ email: " not-an-email ", password: " a " }),
    ).toEqual({ email: "not-an-email", password: " a " });
  });

  it("asks for both fields", () => {
    expect(loginErrors("email", " ")).toEqual(["Masukkan email Anda."]);
    expect(loginErrors("password", "")).toEqual(["Masukkan kata sandi Anda."]);
  });

  it("keeps the API's length limits", () => {
    expect(loginErrors("email", "a".repeat(255))).toEqual([
      "Email paling panjang 254 karakter.",
    ]);
    expect(loginErrors("password", "a".repeat(1024))).toEqual([]);
    expect(loginErrors("password", "a".repeat(1025))).toEqual([
      "Kata sandi terlalu panjang.",
    ]);
  });
});
