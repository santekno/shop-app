import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { session, user } from "@/test/fixtures.ts";
import { deferred, noContent } from "@/test/msw/answers.ts";
import { webLogoutHandler } from "@/test/msw/auth.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoutes } from "@/test/render.tsx";
import { RequireStaff } from "./RequireStaff.tsx";
import { NoAccessPage } from "./NoAccessPage.tsx";

const buyer = user({ role: "buyer", email: "budi@example.com" });

/** The page behind RequireStaff, as the app has it, so a logout shows /masuk. */
const renderPage = () =>
  renderRoutes(
    [
      {
        element: <RequireStaff />,
        children: [{ path: "/", element: <p>Dasbor</p> }],
      },
      { path: "/masuk", element: <h1>Halaman masuk</h1> },
    ],
    { url: "/", session: { user: buyer, accessToken: "t" } },
  );

describe("NoAccessPage", () => {
  it("says who is logged in, as which role, and why that is not enough", () => {
    renderRoutes([{ path: "/", element: <NoAccessPage user={buyer} /> }], {
      session: session("buyer"),
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Tidak ada akses" }),
    ).toBeInTheDocument();
    expect(screen.getByText("budi@example.com")).toBeInTheDocument();
    expect(screen.getByText("Pembeli")).toBeInTheDocument();
    expect(
      screen.getByText(/hanya untuk penjual dan admin/),
    ).toBeInTheDocument();
    expect(document.title).toBe("Tidak ada akses — GoShop Admin");
  });

  it("logs out of the dashboard's session and lands on /masuk", async () => {
    const sent = recordRequests();
    server.use(webLogoutHandler(() => noContent()));
    const userEvents = userEvent.setup();
    const { router } = renderPage();

    await userEvents.click(screen.getByRole("button", { name: "Keluar" }));

    expect(
      await screen.findByRole("heading", { name: "Halaman masuk" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/masuk");
    expect(
      sent.map((r) => [r.url.pathname, r.headers.get("X-GoShop-Client")]),
    ).toEqual([["/v1/auth/web/logout", "admin"]]);
  });

  it("disables the button and says it is working while the logout runs", async () => {
    const answer = deferred<Response>();
    server.use(webLogoutHandler(() => answer.promise));
    const userEvents = userEvent.setup();
    renderPage();

    await userEvents.click(screen.getByRole("button", { name: "Keluar" }));

    const button = await screen.findByRole("button", { name: "Memproses…" });
    expect(button).toBeDisabled();
    answer.resolve(noContent());
    expect(
      await screen.findByRole("heading", { name: "Halaman masuk" }),
    ).toBeInTheDocument();
  });

  it("stays logged in and says so when the logout fails", async () => {
    server.use(webLogoutHandler(() => errorResponse(500, "INTERNAL_ERROR")));
    const userEvents = userEvent.setup();
    renderPage();

    await userEvents.click(screen.getByRole("button", { name: "Keluar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Gagal keluar. Periksa koneksi Anda, lalu coba lagi.",
    );
    expect(
      screen.getByRole("heading", { name: "Tidak ada akses" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keluar" })).toBeEnabled();
  });
});
