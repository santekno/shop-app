import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useRouteFocus } from "./useRouteFocus.ts";

function Layout() {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  return (
    <main ref={mainRef} tabIndex={-1}>
      <Outlet />
    </main>
  );
}

function Catalog() {
  return (
    <>
      <h1 tabIndex={-1}>Katalog</h1>
      <a href="/produk/kaos" data-product-slug="kaos">
        Kaos
      </a>
    </>
  );
}

const setup = (url = "/") => {
  const router = createMemoryRouter(
    [
      {
        Component: Layout,
        children: [
          { path: "/", Component: Catalog },
          { path: "/produk/:slug", element: <h1 tabIndex={-1}>Produk</h1> },
          { path: "/kosong", element: <p>Belum ada judul</p> },
        ],
      },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  const go = (to: string) => act(() => router.navigate(to));
  const back = () => act(() => router.navigate(-1));
  return { router, go, back };
};

const heading = (name: string) =>
  screen.getByRole("heading", { level: 1, name });

describe("useRouteFocus", () => {
  it("moves nothing on the first render", () => {
    setup("/");

    expect(document.activeElement).toBe(document.body);
  });

  it("focuses the new page's h1 after a navigation, without scrolling", async () => {
    const { go } = setup("/");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    await go("/produk/kemeja");

    expect(document.activeElement).toBe(heading("Produk"));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it("returns to the card of the product the buyer came back from, scrolling to it", async () => {
    const { go } = setup("/produk/kaos");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    await go("/");

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Kaos" }),
    );
    expect(focus).toHaveBeenLastCalledWith();
    focus.mockRestore();
  });

  it("falls back to the h1 when the product has no card on the page", async () => {
    const { go } = setup("/produk/lain");

    await go("/");

    expect(document.activeElement).toBe(heading("Katalog"));
  });

  it("focuses <main> when the page has no h1 yet", async () => {
    const { go } = setup("/");

    await go("/kosong");

    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("leaves the focus where it is when only the query string changes", async () => {
    const { go } = setup("/");
    const link = screen.getByRole("link", { name: "Kaos" });
    link.focus();

    await go("/?kategori=kaos");
    await go("/?kategori=kaos&urut=termurah");

    expect(document.activeElement).toBe(link);
  });

  it("handles Back like any other navigation", async () => {
    const { go, back } = setup("/");
    await go("/produk/kaos");

    await back();

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Kaos" }),
    );
  });
});
