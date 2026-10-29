import { z } from "./zod.ts";
import { characters, hasNoNul } from "./text.ts";
import type { LoginRequest, RegisterRequest } from "../api/types.ts";

// The rules of POST /v1/auth/register and /v1/auth/login, as Zod schemas.
// They mirror api/openapi.yaml (RegisterRequest, LoginRequest) and what
// the API's handler really checks (apps/api/internal/auth: handler.go and
// password.go). A client check is a convenience: it answers at once, in
// the buyer's language, but the API checks everything again and has the
// last word. Shared by the web app and, from Bab 13, the mobile app, so
// both ask the same.

/** The password policy (NIST SP 800-63B): a length, and no rules about
 *  digits or symbols. The API also refuses the most common leaked
 *  passwords; that list stays on the server. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 100;
/** Login checks only a sane length: an old account may predate the policy. */
const LOGIN_PASSWORD_MAX_LENGTH = 1024;

/**
 * An ASCII email address as the API's `email` rule accepts it: a dot-atom
 * before the @ (no leading, trailing or double dot), then domain labels
 * that do not start or end with a hyphen, at least two of them, the last
 * one starting and ending with a letter. The API also accepts a quoted
 * local part ("a b"@example.com); this pattern refuses it, the one place
 * where the client is stricter than the server. ASCII only, as the API
 * requires (it stores emails lower-cased, and only ASCII lower-cases the
 * same way in Go and PostgreSQL).
 */
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z])?$/;

/**
 * The email of a new account. `trim()` comes first, like the API's
 * strings.TrimSpace, so the checks after it see the trimmed value, and so
 * does the request: the schema's output is what gets sent.
 */
const newEmail = z
  .string()
  .trim()
  .min(1, "Masukkan email Anda.")
  .max(EMAIL_MAX_LENGTH, `Email paling panjang ${EMAIL_MAX_LENGTH} karakter.`)
  .regex(
    EMAIL_PATTERN,
    "Masukkan alamat email yang benar, misalnya budi@example.com.",
  );

/** The API's CheckPassword: length in characters, then not only spaces.
 *  Never trimmed: spaces are part of a password. */
const newPassword = z
  .string()
  .min(1, "Buat kata sandi.")
  .refine(
    (value) =>
      characters(value) >= PASSWORD_MIN_LENGTH &&
      characters(value) <= PASSWORD_MAX_LENGTH,
    `Kata sandi harus ${PASSWORD_MIN_LENGTH} sampai ${PASSWORD_MAX_LENGTH} karakter.`,
  )
  .refine(
    (value) => value.trim() !== "",
    "Kata sandi tidak boleh hanya berisi spasi.",
  );

const name = z
  .string()
  .trim()
  .min(1, "Masukkan nama Anda.")
  .refine(
    (value) => characters(value) <= NAME_MAX_LENGTH,
    `Nama paling panjang ${NAME_MAX_LENGTH} karakter.`,
  )
  .refine(hasNoNul, "Nama berisi karakter yang tidak didukung.");

/**
 * The registration form. `satisfies z.ZodType<RegisterRequest>` makes the
 * compiler check the schema against the type generated from the
 * contract: a field the contract requires that the schema lacks, or one
 * typed differently, is a compile error here, not a 400 at run time. It
 * checks one direction only: a field the schema adds that the contract
 * does not have still compiles (the API would refuse it as unknown), so a
 * type test with expectTypeOf(...).toEqualTypeOf<RegisterRequest>()
 * checks that the two are exactly equal.
 */
export const registerSchema = z.object({
  name,
  email: newEmail,
  password: newPassword,
}) satisfies z.ZodType<RegisterRequest>;

/**
 * The login form: only presence and the API's length limits. No email
 * format and no password policy: a malformed email simply matches no
 * account, and the answer to a wrong one is the same 401 either way.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Masukkan email Anda.")
    .max(
      EMAIL_MAX_LENGTH,
      `Email paling panjang ${EMAIL_MAX_LENGTH} karakter.`,
    ),
  password: z
    .string()
    .min(1, "Masukkan kata sandi Anda.")
    .max(LOGIN_PASSWORD_MAX_LENGTH, "Kata sandi terlalu panjang."),
}) satisfies z.ZodType<LoginRequest>;

/** What a form holds (before trimming) and what it sends (after). */
export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
