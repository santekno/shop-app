import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { session, user, webSession } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { sessionResponse, webRefreshHandler } from "@/test/msw/auth.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoutes } from "@/test/render.tsx";
import type { TestSession } from "@/test/render.tsx";
import { RequireStaff } from "./RequireStaff.tsx";

const renderGuarded = (url: string, who: TestSession) =>
  renderRoutes(
    [
      {
        element: <RequireStaff />,
        children: [{ path: "*", element: <h1>Dasbor rahasia</h1> }],
      },
      { path: "/masuk", element: <h1>Halaman masuk</h1> },
    ],
    { url, session: who },
  );

describe("RequireStaff", () => {
  it("waits while the session is being restored, deciding nothing", async () => {
    const answer = deferred<Response>();
    server.use(webRefreshHandler(() => answer.promise));
    const { router } = renderGuarded("/pesanan", "restore");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Memeriksa sesi Anda…",
    );
    expect(screen.queryByText("Dasbor rahasia")).toBeNull();
    expect(router.state.location.pathname).toBe("/pesanan");

    await act(async () => {
      answer.resolve(
        sessionResponse(webSession("t", user({ role: "seller" }))),
      );
      await answer.promise;
    });
    expect(
      await screen.findByRole("heading", { name: "Dasbor rahasia" }),
    ).toBeInTheDocument();
  });

  it("sends an anonymous visitor to /masuk with the whole address in kembali, replacing it", async () => {
    const { router } = renderGuarded("/pesanan/o-1?tab=x#barang", null);

    expect(
      await screen.findByRole("heading", { name: "Halaman masuk" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/masuk");
    expect(
      new URLSearchParams(router.state.location.search).get("kembali"),
    ).toBe("/pesanan/o-1?tab=x#barang");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("shows a buyer the no-access page instead of the dashboard", () => {
    renderGuarded(
      "/pesanan",
      session("buyer", "t", { email: "budi@example.com" }),
    );

    expect(
      screen.getByRole("heading", { name: "Tidak ada akses" }),
    ).toBeInTheDocument();
    expect(screen.getByText("budi@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Dasbor rahasia")).toBeNull();
  });

  it.each(["seller", "admin"] as const)("lets a %s through", (role) => {
    renderGuarded("/pesanan", session(role));

    expect(
      screen.getByRole("heading", { name: "Dasbor rahasia" }),
    ).toBeInTheDocument();
  });
});
