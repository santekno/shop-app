import { ApiError } from "@goshop/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppLoading } from "./AppLoading.tsx";
import { RootErrorPage, RouteErrorPage } from "./RouteErrorPage.tsx";

function Throws({ error }: { error: unknown }): never {
  throw error;
}

const renderError = (error: unknown, Boundary = RouteErrorPage) => {
  const router = createMemoryRouter(
    [{ path: "/", element: <Throws error={error} />, ErrorBoundary: Boundary }],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} onError={() => undefined} />);
};

describe("RouteErrorPage", () => {
  it("says the page failed, with a way to reload and a way back", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderError(new Error("boom"));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Terjadi kesalahan");
    expect(alert).toHaveTextContent("Halaman ini gagal ditampilkan.");
    expect(
      screen.getByRole("link", { name: "Kembali ke ringkasan" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByText(/Kode permintaan/)).toBeNull();
    expect(document.title).toBe("Terjadi kesalahan — GoShop Admin");
  });

  it("quotes the request ID of an API error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderError(
      new ApiError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "x",
        requestId: "req-77",
      }),
    );

    expect(screen.getByText("req-77")).toBeInTheDocument();
    expect(screen.getByText(/Kode permintaan/)).toBeInTheDocument();
  });

  it("reloads the page from its button", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const user = userEvent.setup();
    renderError(new Error("boom"));

    await user.click(
      screen.getByRole("button", { name: "Muat ulang halaman" }),
    );

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("RootErrorPage", () => {
  it("brings its own <main> around the same message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderError(new Error("boom"), RootErrorPage);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "konten");
    expect(main).toHaveTextContent("Terjadi kesalahan");
  });
});

describe("AppLoading", () => {
  it("says the dashboard is loading, politely", () => {
    render(<AppLoading />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Memuat dasbor GoShop…",
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
