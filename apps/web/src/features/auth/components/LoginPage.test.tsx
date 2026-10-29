import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  errorResponse,
  fetchMock,
  requestUrl,
  user as account,
  webSessionResponse,
} from "@/test/fake-api.ts";
import { setNavigationState } from "@/lib/navigation-state.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { registeredState } from "../navigation-state.ts";
import { LoginPage } from "./LoginPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const email = () => screen.getByLabelText<HTMLInputElement>("Email");
const password = () => screen.getByLabelText<HTMLInputElement>("Kata sandi");
const submit = () => screen.getByRole("button", { name: /Masuk|Memproses/ });

const renderLogin = (url = "/masuk") =>
  renderWithProviders(<LoginPage />, { path: "/masuk", url });

const loginRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/auth/web/login",
  );

beforeEach(() => {
  fetchMock.mockReset();
});

describe("LoginPage", () => {
  it("shows the form with its heading and a link to Daftar", () => {
    renderLogin();

    expect(
      screen.getByRole("heading", { level: 1, name: "Masuk" }),
    ).toBeTruthy();
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
    fetchMock.mockResolvedValue(webSessionResponse());
    const { router } = renderLogin();

    await user.type(email(), "  budi@example.com ");
    await user.type(password(), " rahasia ");
    await user.click(submit());

    await vi.waitFor(() => {
      expect(currentLocation()).toBe("/");
    });
    expect(router.lastAction).toBe("replace");
    expect(loginRequests()[0]?.[1]?.body).toBe(
      JSON.stringify({ email: "budi@example.com", password: " rahasia " }),
    );
  });

  it("disables the button and says Memproses… while logging in", async () => {
    const user = userEvent.setup();
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    renderLogin();

    await user.type(email(), "budi@example.com");
    await user.type(password(), "rahasia");
    await user.click(submit());

    expect(submit().textContent).toBe("Memproses…");
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    // Settle it: a login holds the session lock (refresh-lock.ts, a
    // module-level queue in jsdom) until its answer arrives, and the next
    // test's login would wait behind this one forever.
    answer.resolve(errorResponse(401, "INVALID_CREDENTIALS"));
    await vi.waitFor(() => {
      expect((submit() as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("says the account was created and fills in its email after registering", () => {
    // What RegisterPage leaves for /masuk before it goes there.
    setNavigationState("/masuk", registeredState("baru@example.com"));
    renderLogin();

    expect(screen.getByRole("status").textContent).toBe(
      "Akun Anda sudah dibuat. Silakan masuk.",
    );
    expect(email().value).toBe("baru@example.com");
  });
});

describe("LoginPage and ?kembali=", () => {
  const logIn = async () => {
    const user = userEvent.setup();
    await user.type(email(), "budi@example.com");
    await user.type(password(), "rahasia");
    await user.click(submit());
  };

  it("goes back to the page in kembali after the login, query and hash kept", async () => {
    fetchMock.mockResolvedValue(webSessionResponse());
    const { router } = renderLogin(
      `/masuk?kembali=${encodeURIComponent("/akun?tab=profil#alamat")}`,
    );

    await logIn();

    await vi.waitFor(() => {
      expect(router.location.pathname).toBe("/akun");
    });
    expect(router.location.search).toBe("?tab=profil");
    expect(router.location.hash).toBe("#alamat");
    expect(router.lastAction).toBe("replace");
  });

  it.each([
    ["another host", "//evil.example/x"],
    ["an absolute URL", "https://evil.example/masuk"],
    ["a script", "javascript:alert(1)"],
    ["the login page itself", "/masuk?kembali=/akun"],
  ])("goes to the catalog instead of %s", async (_name, kembali) => {
    fetchMock.mockResolvedValue(webSessionResponse());
    renderLogin(`/masuk?kembali=${encodeURIComponent(kembali)}`);

    await logIn();

    await vi.waitFor(() => {
      expect(currentLocation()).toBe("/");
    });
  });

  it("sends a buyer who is already logged in on at once, without a request", () => {
    const { router } = renderWithProviders(<LoginPage />, {
      path: "/masuk",
      url: "/masuk?kembali=%2Fakun",
      session: { user: account(), accessToken: "a" },
    });

    expect(router.location.pathname).toBe("/akun");
    expect(router.lastAction).toBe("replace");
    expect(screen.queryByRole("heading", { name: "Masuk" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
