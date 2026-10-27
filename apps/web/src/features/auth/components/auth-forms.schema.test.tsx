import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMock } from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { RegisterPage } from "./RegisterPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

/** The error text under a field, read through aria-describedby. */
const errorOf = (label: string) => {
  const ids = field(label).getAttribute("aria-describedby") ?? "";
  return ids
    .split(" ")
    .map((id) => document.getElementById(id))
    .find((element) => element?.classList.contains("field__error"))
    ?.textContent;
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("LoginPage's checks (loginSchema)", () => {
  it("asks for both fields, focuses the first, and sends nothing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { path: "/masuk", url: "/masuk" });

    await user.click(screen.getByRole("button", { name: "Masuk" }));

    expect(errorOf("Email")).toBe("Masukkan email Anda.");
    expect(errorOf("Kata sandi")).toBe("Masukkan kata sandi Anda.");
    expect(field("Email").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("Email"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not judge the email's format at login", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<LoginPage />, { path: "/masuk", url: "/masuk" });

    await user.type(field("Email"), "bukan-email");
    await user.type(field("Kata sandi"), "x");
    await user.click(screen.getByRole("button", { name: "Masuk" }));

    expect(errorOf("Email")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterPage's checks (registerSchema)", () => {
  const renderRegister = () =>
    renderWithProviders(<RegisterPage />, { path: "/daftar", url: "/daftar" });

  it("puts each rule's message under its field and focuses the first invalid one", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(field("Nama"), "Budi");
    await user.type(field("Email"), "budi@localhost");
    await user.type(field("Kata sandi"), "pendek");
    await user.click(screen.getByRole("button", { name: "Daftar" }));

    expect(errorOf("Nama")).toBeUndefined();
    expect(errorOf("Email")).toBe(
      "Masukkan alamat email yang benar, misalnya budi@example.com.",
    );
    expect(errorOf("Kata sandi")).toBe(
      "Kata sandi harus 8 sampai 128 karakter.",
    );
    expect(document.activeElement).toBe(field("Email"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the hint and adds the error to the password's description", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(field("Kata sandi"), "        ");
    await user.click(screen.getByRole("button", { name: "Daftar" }));

    const described = (
      field("Kata sandi").getAttribute("aria-describedby") ?? ""
    )
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([
      "8 sampai 128 karakter. Hindari kata sandi yang umum dipakai.",
      "Kata sandi tidak boleh hanya berisi spasi.",
    ]);
  });

  it("asks for a name first when everything is empty", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.click(screen.getByRole("button", { name: "Daftar" }));

    expect(errorOf("Nama")).toBe("Masukkan nama Anda.");
    expect(errorOf("Email")).toBe("Masukkan email Anda.");
    expect(errorOf("Kata sandi")).toBe("Buat kata sandi.");
    expect(document.activeElement).toBe(field("Nama"));
  });
});
