import { ApiError } from "@goshop/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, data, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { RouteErrorPage } from "./RouteErrorPage.tsx";

/** What the broken route throws in the current test. */
let thrown: unknown;

function Broken(): never {
  throw thrown;
}

const renderBroken = (error: unknown) => {
  thrown = error;
  const router = createMemoryRouter(
    [
      { path: "/", element: <h1>Katalog</h1> },
      { path: "/rusak", Component: Broken, ErrorBoundary: RouteErrorPage },
    ],
    { initialEntries: ["/rusak"] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

/** A route whose loader throws `response`, as a data router turns it into
 *  an error response (isRouteErrorResponse). */
const renderFailedLoader = async (response: unknown) => {
  const router = createMemoryRouter(
    [
      {
        path: "/rusak",
        loader: () => {
          throw response;
        },
        Component: () => <p>never</p>,
        ErrorBoundary: RouteErrorPage,
        HydrateFallback: () => null,
      },
    ],
    { initialEntries: ["/rusak"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1 });
};

beforeEach(() => {
  document.title = "GoShop";
  // React logs every error a boundary catches.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RouteErrorPage", () => {
  it("shows the 404 page for a product the API says does not exist", () => {
    renderBroken(
      new ApiError({
        status: 404,
        code: "NOT_FOUND",
        message: "x",
        requestId: "r",
      }),
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Halaman tidak ditemukan",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Produk ini tidak ada atau sudah tidak dijual."),
    ).toBeTruthy();
    expect(document.title).toBe("Halaman tidak ditemukan — GoShop");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Muat ulang halaman" }),
    ).toBeNull();
  });

  it("shows the 404 page for a route's own 404 response", async () => {
    await renderFailedLoader(data("missing", { status: 404 }));

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Halaman tidak ditemukan",
      }),
    ).toBeTruthy();
  });

  it.each([
    ["a TypeError", new TypeError("x is undefined")],
    [
      "another ApiError",
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "x" }),
    ],
    [
      "a CART_NOT_FOUND 404",
      new ApiError({ status: 404, code: "CART_NOT_FOUND", message: "x" }),
    ],
  ])(
    "shows anything else (%s) as an unexpected error with a reload",
    (_, error) => {
      renderBroken(error);

      const alert = screen.getByRole("alert");
      expect(
        within(alert).getByRole("heading", {
          level: 1,
          name: "Terjadi kesalahan",
        }),
      ).toBeTruthy();
      expect(document.title).toBe("Terjadi kesalahan — GoShop");
      expect(
        within(alert).getByRole("button", { name: "Muat ulang halaman" }),
      ).toBeTruthy();
      expect(alert.textContent).not.toContain("Kode permintaan");
    },
  );

  it("shows a route's 500 response as an unexpected error", async () => {
    await renderFailedLoader(data("broken", { status: 500 }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Terjadi kesalahan" }),
    ).toBeTruthy();
  });

  it("quotes the request ID of an API error", () => {
    renderBroken(
      new ApiError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "x",
        requestId: "req-77",
      }),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Kode permintaan: req-77",
    );
    expect(screen.getByText("req-77").tagName).toBe("CODE");
  });

  it("reloads the page from its button", async () => {
    const user = userEvent.setup();
    renderBroken(new Error("boom"));

    // jsdom cannot reload (and its location cannot be stubbed); the click
    // must at least reach window.location.reload without failing.
    await user.click(
      screen.getByRole("button", { name: "Muat ulang halaman" }),
    );

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("leaves the error behind with the link back to the catalog", async () => {
    const user = userEvent.setup();
    renderBroken(new Error("boom"));

    await user.click(screen.getByRole("link", { name: "Kembali ke katalog" }));

    expect(screen.getByRole("heading", { name: "Katalog" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("NotFoundPage", () => {
  it("says the address does not exist by default, with a link to the catalog", () => {
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: "*", Component: NotFoundPage }])}
      />,
    );

    expect(
      screen.getByText(
        "Alamat ini tidak ada di GoShop. Mungkin tautannya salah ketik.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Kembali ke katalog" })
        .getAttribute("href"),
    ).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).tabIndex).toBe(-1);
  });
});
