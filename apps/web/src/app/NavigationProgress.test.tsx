import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { deferred } from "@/test/fake-api.ts";
import { AppLoading } from "./AppLoading.tsx";
import { NavigationProgress } from "./NavigationProgress.tsx";

const bar = () => document.querySelector(".navigation-progress");

describe("NavigationProgress", () => {
  it("shows a bar and announces Memuat halaman… while the next page loads", async () => {
    const chunk = deferred<{ Component: () => React.JSX.Element }>();
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <>
            <NavigationProgress />
            <Outlet />
          </>
        ),
        children: [
          { index: true, element: <p>Beranda</p> },
          { path: "lambat", lazy: () => chunk.promise },
        ],
      },
    ]);
    render(<RouterProvider router={router} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    expect(bar()).toBeNull();

    act(() => {
      void router.navigate("/lambat");
    });
    await vi.waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Memuat halaman…");
    });
    expect(screen.getByRole("status")).toBe(status);
    expect(bar()?.getAttribute("aria-hidden")).toBe("true");
    // The old page stays until the new one is ready.
    expect(screen.getByText("Beranda")).toBeTruthy();

    await act(async () => {
      chunk.resolve({ Component: () => <p>Halaman lambat</p> });
      await chunk.promise;
    });

    expect(await screen.findByText("Halaman lambat")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(bar()).toBeNull();
  });
});

describe("AppLoading", () => {
  it("announces that the storefront is loading", () => {
    render(<AppLoading />);

    expect(screen.getByRole("status").textContent).toBe("Memuat GoShop…");
  });
});
