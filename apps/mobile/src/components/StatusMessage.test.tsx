import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { ApiError } from "@goshop/shared";

import { EmptyState, ErrorState, LoadingState } from "./StatusMessage";

describe("LoadingState", () => {
  it("is a progress bar a screen reader announces by its label", async () => {
    await render(<LoadingState label="Memuat produk…" />);

    expect(
      screen.getByRole("progressbar", { name: "Memuat produk…" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Memuat produk…")).toBeOnTheScreen();
  });
});

describe("EmptyState", () => {
  it("shows its message", async () => {
    await render(<EmptyState message="Belum ada produk." />);
    expect(screen.getByText("Belum ada produk.")).toBeOnTheScreen();
  });
});

describe("ErrorState", () => {
  const withId = new ApiError({
    status: 500,
    code: "INTERNAL",
    message: "boom",
    requestId: "req-42",
  });

  it("is an alert with the buyer's sentence and the request ID", async () => {
    await render(<ErrorState error={withId} />);

    // The alert role sits on the View around both lines, which is not an
    // accessibility element of its own, so getByRole does not find it:
    // the message's parent carries the role.
    const message = screen.getByText(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
    expect(message.parent).toHaveProp("accessibilityRole", "alert");
    expect(message.parent).toHaveTextContent(
      "Terjadi kesalahan saat memuat data. Coba lagi.Kode permintaan: req-42",
    );
    expect(screen.getByText("Kode permintaan: req-42")).toHaveProp(
      "selectable",
      true,
    );
  });

  it("leaves the request ID line out when there is none", async () => {
    await render(
      <ErrorState
        error={new ApiError({ status: 0, code: "NETWORK_ERROR", message: "x" })}
      />,
    );

    expect(
      screen.getByText(/Tidak dapat terhubung ke server GoShop/),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Kode permintaan/)).not.toBeOnTheScreen();
  });

  it("offers Coba lagi only with onRetry, and calls it", async () => {
    const onRetry = jest.fn();
    await render(<ErrorState error={withId} onRetry={onRetry} />);

    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await screen.rerender(<ErrorState error={withId} />);
    expect(screen.queryByRole("button")).not.toBeOnTheScreen();
  });
});
