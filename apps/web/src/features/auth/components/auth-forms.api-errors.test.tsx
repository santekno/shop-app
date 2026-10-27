import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  fetchMock,
  validationResponse,
} from "@/test/fake-api.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { RegisterPage } from "./RegisterPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const errorOf = (label: string) => {
  const ids = field(label).getAttribute("aria-describedby") ?? "";
  return ids
    .split(" ")
    .map((id) => document.getElementById(id))
    .find((element) => element?.className === "field__error")?.textContent;
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("LoginPage and the API's answer", () => {
  const submitLogin = async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { path: "/masuk", url: "/masuk" });
    await user.type(field("Email"), "budi@example.com");
    await user.type(field("Kata sandi"), "salah-sekali");
    await user.click(screen.getByRole("button", { name: "Masuk" }));
  };

  it("shows INVALID_CREDENTIALS above the button, naming neither field", async () => {
    fetchMock.mockResolvedValue(errorResponse(401, "INVALID_CREDENTIALS"));
    await submitLogin();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Email atau kata sandi salah.",
    );
    expect(errorOf("Email")).toBeUndefined();
    expect(errorOf("Kata sandi")).toBeUndefined();
    expect(currentLocation()).toBe("/masuk");
  });

  it("moves the focus to INVALID_CREDENTIALS, again after each failed try", async () => {
    // A new Response per call: a body can be read only once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(401, "INVALID_CREDENTIALS")),
    );
    await submitLogin();

    const alert = await screen.findByRole("alert");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
    // Focusable from code, but not a stop for Tab.
    expect(alert.tabIndex).toBe(-1);

    // The buyer corrects the password and tries again: wrong again.
    const user = userEvent.setup();
    await user.clear(field("Kata sandi"));
    await user.type(field("Kata sandi"), "masih-salah");
    // Typing re-renders the form; the error does not pull the focus back.
    expect(document.activeElement).toBe(field("Kata sandi"));

    await user.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("alert"));
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Email atau kata sandi salah.",
    );
  });

  it("puts a field's VALIDATION_FAILED detail under that field", async () => {
    fetchMock.mockResolvedValue(
      validationResponse({ email: "must be an email address" }),
    );
    await submitLogin();

    await vi.waitFor(() => {
      expect(errorOf("Email")).toBe(
        "Masukkan alamat email yang benar, misalnya budi@example.com.",
      );
    });
    expect(document.activeElement).toBe(field("Email"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a network failure above the button", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await submitLogin();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
    );
  });
});

describe("RegisterPage and the API's answer", () => {
  const submitRegister = async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />, { path: "/daftar", url: "/daftar" });
    await user.type(field("Nama"), "Budi");
    await user.type(field("Email"), "budi@example.com");
    await user.type(field("Kata sandi"), "password123");
    await user.click(screen.getByRole("button", { name: "Daftar" }));
  };

  it("puts the server's password refusal under the password and focuses it", async () => {
    fetchMock.mockResolvedValue(
      validationResponse({ password: "is too common; choose another" }),
    );
    await submitRegister();

    await vi.waitFor(() => {
      expect(errorOf("Kata sandi")).toBe(
        "Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.",
      );
    });
    expect(field("Kata sandi").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("Kata sandi"));
    expect(currentLocation()).toBe("/daftar");
  });

  it("focuses the first of several refused fields", async () => {
    fetchMock.mockResolvedValue(
      validationResponse({
        password: "must be at least 8 characters",
        name: "is required",
      }),
    );
    await submitRegister();

    await vi.waitFor(() => {
      expect(errorOf("Nama")).toBe("Wajib diisi.");
    });
    expect(errorOf("Kata sandi")).toBe("Minimal 8 karakter.");
    expect(document.activeElement).toBe(field("Nama"));
  });

  it("puts EMAIL_TAKEN under the email and focuses it", async () => {
    fetchMock.mockResolvedValue(errorResponse(409, "EMAIL_TAKEN"));
    await submitRegister();

    await vi.waitFor(() => {
      expect(errorOf("Email")).toBe(
        "Email ini sudah terdaftar. Silakan masuk, atau gunakan email lain.",
      );
    });
    expect(document.activeElement).toBe(field("Email"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows anything else above the button and moves the focus to it", async () => {
    fetchMock.mockResolvedValue(validationResponse({ body: "must be JSON" }));
    await submitRegister();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Permintaan tidak berhasil. Periksa isian Anda, lalu coba lagi.",
    );
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
  });

  it("moves the focus to a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await submitRegister();

    const alert = await screen.findByRole("alert");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
  });
});
