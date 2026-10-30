import { ApiError } from "@goshop/shared";
import type { UseFormSetError } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { fieldMessage, setApiFieldErrors } from "./api-form-errors.ts";

interface Form {
  name: string;
  email: string;
  password: string;
}

const validationFailed = (details: Record<string, unknown>) =>
  new ApiError({
    status: 400,
    code: "VALIDATION_FAILED",
    message: "invalid",
    details,
  });

describe("fieldMessage", () => {
  it.each([
    ["is required", "Wajib diisi."],
    ["must be between 8 and 128 characters", "Harus 8 sampai 128 karakter."],
    ["must be at least 8 characters", "Minimal 8 karakter."],
    ["must be at most 100 characters", "Paling panjang 100 karakter."],
    [
      "must be an email address",
      "Masukkan alamat email yang benar, misalnya budi@example.com.",
    ],
    [
      "must be an email address (ASCII)",
      "Masukkan alamat email yang benar, misalnya budi@example.com.",
    ],
    [
      "must contain only ASCII characters",
      "Gunakan huruf tanpa aksen, angka dan tanda baca biasa saja.",
    ],
    ["must not be only spaces", "Tidak boleh hanya berisi spasi."],
    [
      "is too common; choose another password",
      "Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.",
    ],
    [
      "must be valid UTF-8 text without NUL characters",
      "Berisi karakter yang tidak didukung.",
    ],
    [
      "must be an Indonesian phone number (08… or +628…)",
      "Masukkan nomor telepon Indonesia, misalnya 081234567890 atau +6281234567890.",
    ],
    [
      "must be a 5-digit Indonesian postal code",
      "Kode pos terdiri dari 5 angka dan tidak diawali 0, misalnya 40111.",
    ],
    // Products (artikel 03): the limits written the Indonesian way.
    ["must be between 1 and 1000000000", "Harus antara 1 dan 1.000.000.000."],
    ["must be at least 0", "Minimal 0."],
    ["must be at least 1000", "Minimal 1.000."],
    ["must be at most 1000000", "Paling besar 1.000.000."],
    [
      "must be one of: draft, active",
      "Pilih salah satu pilihan yang tersedia.",
    ],
    [
      "must be lower-case letters and digits in words joined by single hyphens",
      "Slug hanya berisi huruf kecil, angka dan tanda hubung di antara kata, misalnya kaos-polos-hitam.",
    ],
    [
      "is used by another variant in this request",
      "SKU ini sudah dipakai varian lain di produk ini.",
    ],
    ["is invalid", "Isinya tidak valid."],
  ])("translates %j", (apiText, text) => {
    expect(fieldMessage(apiText)).toBe(text);
  });

  it.each([
    "must be one of buyer, seller",
    "is required!",
    "this is required",
    "must be between eight and ten characters",
    // A character limit is not a number limit, and the other way round.
    "must be between 1 and 10 chars",
    "is invalid!",
  ])("shows %j as the API wrote it", (apiText) => {
    expect(fieldMessage(apiText)).toBe(apiText);
  });
});

describe("setApiFieldErrors", () => {
  const setup = () => vi.fn<UseFormSetError<Form>>();

  it("puts each detail on its field, in the form's order, focusing only the first", () => {
    const setError = setup();

    const applied = setApiFieldErrors<Form>(
      validationFailed({
        password: "is too common; pick another",
        email: "must be an email address",
      }),
      setError,
      ["name", "email", "password"],
    );

    expect(applied).toBe(true);
    expect(setError.mock.calls).toEqual([
      [
        "email",
        {
          type: "server",
          message:
            "Masukkan alamat email yang benar, misalnya budi@example.com.",
        },
        { shouldFocus: true },
      ],
      [
        "password",
        {
          type: "server",
          message:
            "Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.",
        },
        { shouldFocus: false },
      ],
    ]);
  });

  it("ignores details for anything that is not one of the form's fields", () => {
    const setError = setup();

    const applied = setApiFieldErrors<Form>(
      validationFailed({ body: "must be JSON", role: "is required" }),
      setError,
      ["name", "email", "password"],
    );

    expect(applied).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it("ignores a field whose detail is not text", () => {
    const setError = setup();

    const applied = setApiFieldErrors<Form>(
      validationFailed({ email: { reason: "x" }, name: "is required" }),
      setError,
      ["name", "email"],
    );

    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledExactlyOnceWith(
      "name",
      { type: "server", message: "Wajib diisi." },
      { shouldFocus: true },
    );
  });

  it("takes field details only from VALIDATION_FAILED", () => {
    const setError = setup();
    const conflict = new ApiError({
      status: 409,
      code: "EMAIL_TAKEN",
      message: "taken",
      details: { email: "is already registered" },
    });

    expect(setApiFieldErrors<Form>(conflict, setError, ["email"])).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it.each([
    [
      "another ApiError",
      new ApiError({ status: 409, code: "EMAIL_TAKEN", message: "x" }),
    ],
    ["a plain Error", new Error("VALIDATION_FAILED")],
    ["undefined", undefined],
  ])("does nothing for %s", (_, error) => {
    const setError = setup();

    expect(setApiFieldErrors<Form>(error, setError, ["email"])).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});
