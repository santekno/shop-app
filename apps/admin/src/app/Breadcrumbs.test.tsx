import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs.tsx";

/** The dashboard's nesting: the layout's crumb, then the pages' own. */
const renderAt = (url: string) => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <Breadcrumbs />
            <Outlet />
          </>
        ),
        children: [
          {
            handle: { crumb: "Dasbor" },
            element: <Outlet />,
            children: [
              { index: true, handle: { crumb: "Ringkasan" }, element: null },
              {
                path: "produk",
                handle: { crumb: "Produk" },
                children: [
                  { index: true, element: null },
                  {
                    path: ":id",
                    handle: { crumb: "Ubah produk" },
                    element: null,
                  },
                ],
              },
            ],
          },
          { path: "masuk", element: null },
        ],
      },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

describe("Breadcrumbs", () => {
  it("links every step but the last, which is the page on screen", () => {
    renderAt("/produk/p-1");

    const nav = screen.getByRole("navigation", { name: "Jejak navigasi" });
    const items = within(nav).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Dasbor",
      "Produk",
      "Ubah produk",
    ]);
    expect(
      within(nav).getByRole("link", { name: "Dasbor" }).getAttribute("href"),
    ).toBe("/");
    expect(
      within(nav).getByRole("link", { name: "Produk" }).getAttribute("href"),
    ).toBe("/produk");
    expect(within(nav).queryByRole("link", { name: "Ubah produk" })).toBeNull();
    expect(within(nav).getByText("Ubah produk")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("puts a separator hidden from screen readers between two steps only", () => {
    renderAt("/produk/p-1");

    const nav = screen.getByRole("navigation", { name: "Jejak navigasi" });
    const separators = nav.querySelectorAll('li[aria-hidden="true"]');
    expect(separators).toHaveLength(2);
    expect(nav.querySelector("ol")?.lastElementChild).toHaveTextContent(
      "Ubah produk",
    );
  });

  it("gives Dasbor and Ringkasan, which share /, a step each", () => {
    renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Jejak navigasi" });
    expect(within(nav).getByRole("link", { name: "Dasbor" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(nav).getByText("Ringkasan")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders nothing on a page without a crumb", () => {
    renderAt("/masuk");

    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
