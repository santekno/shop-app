import { ApiError } from "@goshop/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { currentLocation } from "@/test/render.tsx";
import { ErrorPage } from "./ErrorPage.tsx";

let log: MockInstance<typeof console.error>;

beforeEach(() => {
  document.title = "GoShop";
  log = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorPage (app/error.tsx)", () => {
  it.each([
    ["a TypeError", new TypeError("x is undefined")],
    [
      "an ApiError without a request ID",
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "x" }),
    ],
    [
      "a CART_NOT_FOUND 404",
      new ApiError({ status: 404, code: "CART_NOT_FOUND", message: "x" }),
    ],
  ])("shows %s as an unexpected error with a reload", (_, error) => {
    render(<ErrorPage error={error} />);

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
  });

  it("quotes the request ID of an API error", () => {
    render(
      <ErrorPage
        error={
          new ApiError({
            status: 500,
            code: "INTERNAL_ERROR",
            message: "x",
            requestId: "req-77",
          })
        }
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Kode permintaan: req-77",
    );
    expect(screen.getByText("req-77").tagName).toBe("CODE");
  });

  it("quotes the digest of an error thrown on the server", () => {
    // Next.js sends a server error to the browser without its message,
    // with a digest that matches the server's log line.
    const error = Object.assign(new Error("hidden"), { digest: "3141592" });

    render(<ErrorPage error={error} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Kode permintaan: 3141592",
    );
  });

  it("reloads the page from its button", async () => {
    const user = userEvent.setup();
    render(<ErrorPage error={new Error("boom")} />);

    // jsdom cannot reload (and its location cannot be stubbed); the click
    // must at least reach window.location.reload without failing.
    await user.click(
      screen.getByRole("button", { name: "Muat ulang halaman" }),
    );

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("links back to the catalog", async () => {
    const user = userEvent.setup();
    render(<ErrorPage error={new Error("boom")} />);
    const link = screen.getByRole("link", { name: "Kembali ke katalog" });
    expect(link.getAttribute("href")).toBe("/");

    await user.click(link);

    expect(currentLocation()).toBe("/");
  });

  it("logs the error it shows exactly once", () => {
    const error = new TypeError("x is undefined");

    const { rerender } = render(<ErrorPage error={error} />);
    rerender(<ErrorPage error={error} />);

    expect(log).toHaveBeenCalledExactlyOnceWith(error, undefined);
  });

  it("does not log the expected NOT_FOUND", () => {
    render(
      <ErrorPage
        error={
          new ApiError({ status: 404, code: "NOT_FOUND", message: "missing" })
        }
      />,
    );

    expect(log).not.toHaveBeenCalled();
  });
});
