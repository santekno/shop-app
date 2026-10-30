import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { session, user, webSession } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { sessionResponse, webLoginHandler } from "@/test/msw/auth.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoutes } from "@/test/render.tsx";
import type { TestSession } from "@/test/render.tsx";
import { LoginPage } from "./LoginPage.tsx";

const renderLogin = (url = "/masuk", who: TestSession = null) =>
  renderRoutes(
    [
      { path: "/masuk", element: <LoginPage /> },
      { path: "*", element: <h1>Tujuan</h1> },
    ],
    { url, session: who },
  );

const fill = async (email: string, password: string) => {
  const userEvents = userEvent.setup();
  if (email !== "")
    await userEvents.type(screen.getByLabelText("Email"), email);
  if (password !== "")
    await userEvents.type(screen.getByLabelText("Kata sandi"), password);
  await userEvents.click(screen.getByRole("button", { name: "Masuk" }));
};

describe("LoginPage", () => {
  it("is a login form with its own title", () => {
    renderLogin();

    expect(
      screen.getByRole("heading", { level: 1, name: "Masuk" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Kata sandi")).toHaveAttribute(
      "type",
      "password",
    );
    expect(document.title).toBe("Masuk — GoShop Admin");
  });

  it("checks both fields before sending anything", async () => {
    const sent = recordRequests();
    renderLogin();

    await fill("", "");

    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Masukkan email Anda.",
    );
    expect(screen.getByLabelText("Kata sandi")).toHaveAccessibleDescription(
      "Masukkan kata sandi Anda.",
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(sent).toEqual([]);
  });

  it("logs in as the dashboard and goes back to the page in kembali, replacing /masuk", async () => {
    const sent = recordRequests();
    server.use(webLoginHandler(() => sessionResponse(webSession("t", user()))));
    const { router } = renderLogin(
      `/masuk?kembali=${encodeURIComponent("/pesanan?status=dikirim")}`,
    );

    await fill("  sari@goshop.test ", "rahasia123");

    expect(
      await screen.findByRole("heading", { name: "Tujuan" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname + router.state.location.search).toBe(
      "/pesanan?status=dikirim",
    );
    expect(router.state.historyAction).toBe("REPLACE");
    expect(sent[0]?.url.pathname).toBe("/v1/auth/web/login");
    expect(sent[0]?.headers.get("X-GoShop-Client")).toBe("admin");
    expect(await sent[0]?.json()).toEqual({
      email: "sari@goshop.test",
      password: "rahasia123",
    });
  });

  it.each(["//evil.example/masuk", "https://evil.example", "/masuk"])(
    "goes to / instead of kembali=%s",
    async (target) => {
      server.use(
        webLoginHandler(() => sessionResponse(webSession("t", user()))),
      );
      const { router } = renderLogin(
        `/masuk?kembali=${encodeURIComponent(target)}`,
      );

      await fill("sari@goshop.test", "rahasia123");

      expect(
        await screen.findByRole("heading", { name: "Tujuan" }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
    },
  );

  it("says 'Memproses…' on a disabled button while the login runs", async () => {
    const answer = deferred<Response>();
    server.use(webLoginHandler(() => answer.promise));
    renderLogin();

    await fill("sari@goshop.test", "rahasia123");

    expect(
      await screen.findByRole("button", { name: "Memproses…" }),
    ).toBeDisabled();
    answer.resolve(sessionResponse(webSession("t", user())));
    expect(
      await screen.findByRole("heading", { name: "Tujuan" }),
    ).toBeInTheDocument();
  });

  it("puts the API's field message under its field, in Indonesian, and focuses it", async () => {
    server.use(
      webLoginHandler(() =>
        errorResponse(400, "VALIDATION_FAILED", {
          details: { email: "must be an email address" },
        }),
      ),
    );
    renderLogin();

    await fill("sari", "rahasia123");

    const email = screen.getByLabelText("Email");
    await screen.findByText(
      "Masukkan alamat email yang benar, misalnya budi@example.com.",
    );
    expect(email).toHaveAccessibleDescription(
      "Masukkan alamat email yang benar, misalnya budi@example.com.",
    );
    expect(email).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows wrong credentials above the button, naming neither field, and focuses it", async () => {
    server.use(
      webLoginHandler(() => errorResponse(401, "INVALID_CREDENTIALS")),
    );
    renderLogin();

    await fill("sari@goshop.test", "salah");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email atau kata sandi salah.");
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Masuk" })).toBeEnabled();
  });

  it("goes straight on when someone is already logged in", () => {
    renderLogin(`/masuk?kembali=${encodeURIComponent("/laporan")}`, session());

    expect(screen.getByRole("heading", { name: "Tujuan" })).toBeInTheDocument();
  });
});
