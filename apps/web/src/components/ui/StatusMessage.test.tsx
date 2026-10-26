import { ApiError } from "@goshop/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "./StatusMessage.tsx";

const serverError = (requestId?: string) =>
  new ApiError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "boom",
    requestId,
  });

describe("LoadingState", () => {
  it("announces its text as a status", () => {
    render(<LoadingState>Memuat produk…</LoadingState>);

    expect(screen.getByRole("status").textContent).toBe("Memuat produk…");
  });
});

describe("EmptyState", () => {
  it("shows its text as a plain muted paragraph, not a status or alert", () => {
    render(<EmptyState>Belum ada produk.</EmptyState>);

    const text = screen.getByText("Belum ada produk.");
    expect(text.tagName).toBe("P");
    expect(text.className).toBe("muted");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ErrorState", () => {
  it("shows the Indonesian message and the request ID in an alert", () => {
    render(<ErrorState error={serverError("req-9")} />);

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeTruthy();
    expect(alert.textContent).toContain("Kode permintaan: req-9");
    expect(within(alert).getByText("req-9").tagName).toBe("CODE");
  });

  it("leaves the request ID out when there is none", () => {
    render(<ErrorState error={new Error("x")} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toContain("Kode permintaan");
    expect(alert.querySelector("code")).toBeNull();
  });

  it("shows Coba lagi only with onRetry, and calls it", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState error={serverError()} />);
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<ErrorState error={serverError()} onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
