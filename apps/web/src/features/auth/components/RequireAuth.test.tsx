import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  fetchMock,
  noContentResponse,
  user,
  webSessionResponse,
} from "@/test/fake-api.ts";
import { LocationProbe } from "@/test/LocationProbe.tsx";
import { createTestQueryClient, providers } from "@/test/render.tsx";
import type { TestSession } from "@/test/render.tsx";
import { RequireAuth } from "./RequireAuth.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

/**
 * RequireAuth as a layout route around a stand-in /akun, as in routes.tsx,
 * opened from "/" so the history has a page before it.
 */
const mount = (url: string, session: TestSession) => {
  const router = createMemoryRouter(
    [
      {
        element: <RequireAuth />,
        children: [{ path: "/akun", element: <h1>Halaman akun</h1> }],
      },
      { path: "*", element: <LocationProbe /> },
    ],
    { initialEntries: ["/", url], initialIndex: 1 },
  );
  render(
    providers(
      createTestQueryClient(),
      <RouterProvider router={router} />,
      session,
    ),
  );
  return router;
};

const accountHeading = () =>
  screen.queryByRole("heading", { name: "Halaman akun" });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("RequireAuth", () => {
  it("renders the page for a logged-in buyer", () => {
    mount("/akun", { user: user(), accessToken: "a" });

    expect(accountHeading()).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a guest to /masuk with the whole page asked for, replacing the entry", () => {
    const router = mount("/akun?tab=profil#alamat", null);

    expect(router.state.location.pathname).toBe("/masuk");
    expect(
      new URLSearchParams(router.state.location.search).get("kembali"),
    ).toBe("/akun?tab=profil#alamat");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(accountHeading()).toBeNull();
  });

  it("waits, deciding nothing, while the session is restored", async () => {
    const refresh = deferred<Response>();
    fetchMock.mockReturnValue(refresh.promise);
    const router = mount("/akun", "restore");

    expect(screen.getByRole("status").textContent).toBe("Memeriksa sesi Anda…");
    expect(router.state.location.pathname).toBe("/akun");
    expect(accountHeading()).toBeNull();

    await act(async () => {
      refresh.resolve(webSessionResponse());
      await refresh.promise;
    });

    expect(
      await screen.findByRole("heading", { name: "Halaman akun" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe("/akun");
  });

  it("redirects once the restore finds no session", async () => {
    const refresh = deferred<Response>();
    fetchMock.mockReturnValue(refresh.promise);
    const router = mount("/akun", "restore");

    await act(async () => {
      refresh.resolve(noContentResponse());
      await refresh.promise;
    });

    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe("/masuk");
    });
    expect(router.state.location.search).toBe("?kembali=%2Fakun");
  });
});
