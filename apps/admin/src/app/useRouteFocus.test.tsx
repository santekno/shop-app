import { act, render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router";
import { describe, expect, it } from "vitest";
import { MAIN_ID, useRouteFocus } from "./useRouteFocus.ts";

function Root() {
  useRouteFocus();
  return (
    <>
      <button type="button">Menu</button>
      <main id={MAIN_ID} tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}

function Page() {
  const { pathname } = useLocation();
  if (pathname === "/tanpa-judul") return <p>Memuat…</p>;
  return <h1 tabIndex={-1}>Halaman {pathname}</h1>;
}

const setup = (url = "/a", main = true) => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: main ? <Root /> : <NoMain />,
        children: [{ path: "*", element: <Page /> }],
      },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  const go = async (to: string) => {
    await act(() => router.navigate(to));
  };
  return { go };
};

function NoMain() {
  useRouteFocus();
  return <Outlet />;
}

describe("useRouteFocus", () => {
  it("moves nothing on the first render", () => {
    setup("/a");

    expect(document.body).toHaveFocus();
  });

  it("focuses the new page's <h1> after a navigation to another path", async () => {
    const { go } = setup("/a");

    await go("/b");

    expect(screen.getByRole("heading", { name: "Halaman /b" })).toHaveFocus();
  });

  it("focuses <main> when the new page has no heading yet", async () => {
    const { go } = setup("/a");

    await go("/tanpa-judul");

    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("leaves the focus where it is when only the query string changes", async () => {
    const { go } = setup("/a");
    const menu = screen.getByRole("button", { name: "Menu" });
    menu.focus();

    await go("/a?status=dikirim");

    expect(menu).toHaveFocus();
  });

  it("does nothing when the page has no <main>", async () => {
    const { go } = setup("/a", false);

    await go("/b");

    expect(document.body).toHaveFocus();
  });
});
