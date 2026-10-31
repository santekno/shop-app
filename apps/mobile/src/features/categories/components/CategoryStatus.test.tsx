import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { ApiError } from "@goshop/shared";

import {
  CategoryError,
  CategoryLoading,
  CategoryOffline,
} from "./CategoryStatus";

const apiError = (code: string, requestId?: string) =>
  new ApiError({ status: 500, code, message: "x", requestId });

describe("CategoryLoading", () => {
  it("is a busy element a screen reader announces", async () => {
    await render(<CategoryLoading />);

    const loading = screen.getByLabelText("Memuat kategori");
    expect(loading).toBeBusy();
    expect(screen.getByText("Memuat kategori…")).toBeOnTheScreen();
  });
});

describe("CategoryOffline", () => {
  it("says the list loads when the network is back, with nothing to press", async () => {
    await render(<CategoryOffline />);

    expect(
      screen.getByText(
        "Tidak ada koneksi internet. Kategori dimuat begitu koneksi kembali.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button")).not.toBeOnTheScreen();
  });
});

describe("CategoryError", () => {
  it.each([
    [
      "NETWORK_ERROR",
      "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
    ],
    [
      "CLIENT_TIMEOUT",
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      "TIMEOUT",
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      "RATE_LIMITED",
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    ],
    ["INTERNAL", "Terjadi kesalahan saat memuat kategori. Coba lagi."],
  ])("says what %s means", async (code, message) => {
    await render(
      <CategoryError error={apiError(code)} onRetry={() => undefined} />,
    );
    expect(screen.getByText(message)).toBeOnTheScreen();
  });

  it("falls back to the general sentence for an error that is not the API's", async () => {
    await render(
      <CategoryError error={new Error("x")} onRetry={() => undefined} />,
    );
    expect(
      screen.getByText("Terjadi kesalahan saat memuat kategori. Coba lagi."),
    ).toBeOnTheScreen();
  });

  it("is an alert, with the request ID to quote", async () => {
    await render(
      <CategoryError
        error={apiError("INTERNAL", "req-77")}
        onRetry={() => undefined}
      />,
    );

    const id = screen.getByText("Kode permintaan: req-77");
    expect(id).toHaveProp("selectable", true);
    expect(id.parent).toHaveProp("accessibilityRole", "alert");
    expect(id.parent).toHaveProp("accessibilityLiveRegion", "polite");
  });

  it("has no request ID line without an ID, or for an error that is not the API's", async () => {
    await render(
      <CategoryError error={apiError("INTERNAL")} onRetry={() => undefined} />,
    );
    expect(screen.queryByText(/Kode permintaan/)).not.toBeOnTheScreen();

    await screen.rerender(
      <CategoryError
        error={{ requestId: "palsu" }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.queryByText(/Kode permintaan/)).not.toBeOnTheScreen();
  });

  it("calls onRetry from Coba lagi", async () => {
    const onRetry = jest.fn();
    await render(
      <CategoryError error={apiError("INTERNAL")} onRetry={onRetry} />,
    );

    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
