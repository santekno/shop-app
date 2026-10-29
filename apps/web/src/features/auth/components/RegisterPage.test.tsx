import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  fetchMock,
  requestUrl,
  user,
  userResponse,
} from "@/test/fake-api.ts";
import { navigationStateFor } from "@/lib/navigation-state.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { registeredEmailFrom } from "../navigation-state.ts";
import { RegisterPage } from "./RegisterPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const submit = () => screen.getByRole("button", { name: /Daftar|Memproses/ });

const renderRegister = () =>
  renderWithProviders(<RegisterPage />, { path: "/daftar", url: "/daftar" });

const registerRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/auth/register",
  );

const fill = async (
  userEvents: ReturnType<typeof userEvent.setup>,
  values: { name?: string; email?: string; password?: string },
) => {
  if (values.name !== undefined)
    await userEvents.type(field("Nama"), values.name);
  if (values.email !== undefined)
    await userEvents.type(field("Email"), values.email);
  if (values.password !== undefined) {
    await userEvents.type(field("Kata sandi"), values.password);
  }
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("RegisterPage", () => {
  it("shows the form with its heading, password hint and a link to Masuk", () => {
    renderRegister();

    expect(
      screen.getByRole("heading", { level: 1, name: "Daftar akun" }),
    ).toBeTruthy();
    expect(field("Nama").autocomplete).toBe("name");
    expect(field("Email").type).toBe("email");
    expect(field("Kata sandi").autocomplete).toBe("new-password");
    expect(
      screen
        .getByRole("textbox", { name: "Nama" })
        .hasAttribute("aria-invalid"),
    ).toBe(false);
    expect(
      screen.getByLabelText("Kata sandi").getAttribute("aria-describedby"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "8 sampai 128 karakter. Hindari kata sandi yang umum dipakai.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Masuk" }).getAttribute("href"),
    ).toBe("/masuk");
  });

  it("registers, then goes to /masuk with the new account's email", async () => {
    const userEvents = userEvent.setup();
    fetchMock.mockResolvedValue(
      userResponse(user({ email: "budi@example.com" })),
    );
    const { router } = renderRegister();

    await fill(userEvents, {
      name: " Budi ",
      email: " budi@example.com ",
      password: "rahasia123",
    });
    await userEvents.click(submit());

    await vi.waitFor(() => {
      expect(currentLocation()).toBe("/masuk");
    });
    expect(router.lastAction).toBe("push");
    expect(registeredEmailFrom(navigationStateFor("/masuk"))).toBe(
      "budi@example.com",
    );
    expect(registerRequests()[0]?.[1]?.body).toBe(
      JSON.stringify({
        name: "Budi",
        email: "budi@example.com",
        password: "rahasia123",
      }),
    );
  });

  it("disables the button and says Memproses… while registering", async () => {
    const userEvents = userEvent.setup();
    fetchMock.mockReturnValue(deferred<Response>().promise);
    renderRegister();

    await fill(userEvents, {
      name: "Budi",
      email: "budi@example.com",
      password: "rahasia123",
    });
    await userEvents.click(submit());

    expect(submit().textContent).toBe("Memproses…");
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
  });
});
