// Registration against the real API: the form checks its input with Zod
// before sending anything, and the API's own refusals (a common password,
// an email already taken) land on the field they concern, linked with
// aria-describedby and focused; a new account goes on to Masuk.
import { expect, test } from "@playwright/test";
import { BUYER } from "../support/accounts.ts";
import {
  authPosts,
  expectFieldError,
  expectOnlyStatusErrors,
} from "../support/auth.ts";
import { watchBrowser } from "../support/browser.ts";

test("the register form checks its fields with Zod before sending anything", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const registers = authPosts(page, "register");
  await page.goto("/daftar");
  const name = page.getByLabel("Nama");
  const email = page.getByLabel("Email");
  const password = page.getByLabel("Kata sandi");
  const submit = page.getByRole("button", { name: "Daftar" });

  await submit.click();
  await expectFieldError(name, "Masukkan nama Anda.");
  await expectFieldError(email, "Masukkan email Anda.");
  await expectFieldError(password, "Buat kata sandi.");
  // The first invalid field takes the focus.
  await expect(name).toBeFocused();
  // The password's hint stays linked next to its error.
  await expect(password).toHaveAttribute(
    "aria-describedby",
    /-hint\b.*-error\b/,
  );

  await name.fill("Budi");
  await email.fill("budi@");
  await password.fill("pendek");
  await submit.click();
  await expectFieldError(
    email,
    "Masukkan alamat email yang benar, misalnya budi@example.com.",
  );
  await expectFieldError(password, "Kata sandi harus 8 sampai 128 karakter.");
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await expect(email).toBeFocused();

  // Nothing reached the API.
  expect(registers).toHaveLength(0);
  expectOnlyStatusErrors(problems, []);
});

test("the API's refusal of a common password lands on the password field", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const registers = authPosts(page, "register");
  await page.goto("/daftar");
  await page.getByLabel("Nama").fill("Budi");
  await page
    .getByLabel("Email")
    .fill(`e2e-${crypto.randomUUID()}@goshop.local`);
  // Long enough for Zod; only the server knows it is on the leaked list.
  const password = page.getByLabel("Kata sandi");
  await password.fill("password123");
  await page.getByRole("button", { name: "Daftar" }).click();

  await expectFieldError(
    password,
    "Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.",
  );
  await expect(password).toBeFocused();
  expect(registers).toHaveLength(1);
  const response = await registers[0]?.response();
  expect(response?.status()).toBe(400);
  expect(
    ((await response?.json()) as { error: { code: string } }).error.code,
  ).toBe("VALIDATION_FAILED");
  expectOnlyStatusErrors(problems, [400]);
});

test("an email that is taken gets EMAIL_TAKEN on the email field", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await page.goto("/daftar");
  await page.getByLabel("Nama").fill("Budi");
  const email = page.getByLabel("Email");
  await email.fill(BUYER.email);
  await page.getByLabel("Kata sandi").fill("teh-manis-hangat-2026");
  await page.getByRole("button", { name: "Daftar" }).click();

  await expectFieldError(
    email,
    "Email ini sudah terdaftar. Silakan masuk, atau gunakan email lain.",
  );
  await expect(email).toBeFocused();
  expectOnlyStatusErrors(problems, [409]);
});

test("a new account is created and the buyer is sent to Masuk with the email filled in", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const address = `e2e-${crypto.randomUUID()}@goshop.local`;
  await page.goto("/daftar");
  await page.getByLabel("Nama").fill("Pembeli Baru");
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Kata sandi").fill("teh-manis-hangat-2026");
  await page.getByRole("button", { name: "Daftar" }).click();

  await expect(page).toHaveURL("/masuk");
  await expect(page.getByRole("status").filter({ hasText: /\S/ })).toHaveText(
    "Akun Anda sudah dibuat. Silakan masuk.",
  );
  await expect(page.getByLabel("Email")).toHaveValue(address);
  expectOnlyStatusErrors(problems, []);
});
