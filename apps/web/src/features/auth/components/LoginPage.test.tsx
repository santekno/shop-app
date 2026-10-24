import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InitialEntry } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  fetchMock,
  requestUrl,
  tokensResponse,
} from "@/test/fake-api.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { registeredState } from "../navigation-state.ts";
import { LoginPage } from "./LoginPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const email = () => screen.getByLabelText<HTMLInputElement>("Email");
const password = () => screen.getByLabelText<HTMLInputElement>("Kata sandi");
const submit = () => screen.getByRole("button", { name: /Masuk|Memproses/ });

const renderLogin = (url: InitialEntry = "/masuk") =>
  renderWithProviders(<LoginPage />, { path: "/masuk", url });

const loginRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/auth/login",
  );

beforeEach(() => {
  fetchMock.mockReset();
  document.title = "GoShop";
});

describe("LoginPage", () => {
  it("shows the form with its heading, title and a link to Daftar", () => {
    renderLogin();

    expect(
      screen.getByRole("heading", { level: 1, name: "Masuk" }),
    ).toBeTruthy();
    expect(document.title).toBe("Masuk — GoShop");
    expect(email().type).toBe("email");
    expect(email().autocomplete).toBe("email");
    expect(password().type).toBe("password");
    expect(password().autocomplete).toBe("current-password");
    expect(
      screen.getByRole("link", { name: "Daftar" }).getAttribute("href"),
    ).toBe("/daftar");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("logs in with the email trimmed, then replaces the page with the catalog", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(tokensResponse());
    const { router } = renderLogin();

    await user.type(email(), "  budi@example.com ");
    await user.type(password(), " rahasia ");
    await user.click(submit());

    await vi.waitFor(() => {
      expect(currentLocation()).toBe("/");
    });
    expect(router.state.historyAction).toBe("REPLACE");
    expect(loginRequests()[0]?.[1]?.body).toBe(
      JSON.stringify({ email: "budi@example.com", password: " rahasia " }),
    );
  });

  it("disables the button and says Memproses… while logging in", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(deferred<Response>().promise);
    renderLogin();

    await user.type(email(), "budi@example.com");
    await user.type(password(), "rahasia");
    await user.click(submit());

    expect(submit().textContent).toBe("Memproses…");
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
  });

  it("says the account was created and fills in its email after registering", () => {
    renderLogin({
      pathname: "/masuk",
      state: registeredState("baru@example.com"),
    });

    expect(screen.getByRole("status").textContent).toBe(
      "Akun Anda sudah dibuat. Silakan masuk.",
    );
    expect(email().value).toBe("baru@example.com");
  });
});
