import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { ApiError } from "@goshop/shared";
import { AccessibilityInfo } from "react-native";

import {
  CategoryError,
  CategoryLoading,
  CategoryOffline,
} from "./CategoryStatus";

const apiError = (code: string, requestId?: string) =>
  new ApiError({ status: 500, code, message: "x", requestId });

const GENERAL = "Terjadi kesalahan saat memuat data. Coba lagi.";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CategoryLoading", () => {
  it("is the app's progress bar, named for the categories", async () => {
    await render(<CategoryLoading />);

    expect(
      screen.getByRole("progressbar", { name: "Memuat kategori…" }),
    ).toBeOnTheScreen();
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
    // The app's general sentence (src/lib/error-message.ts), the same
    // words Beranda uses for the same failure.
    ["INTERNAL", GENERAL],
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
    expect(screen.getByText(GENERAL)).toBeOnTheScreen();
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
    expect(id.parent).toHaveTextContent(
      `${GENERAL}Kode permintaan: req-77Coba lagi`,
    );
  });

  it("is read out by VoiceOver when it appears (jest-expo runs as iOS)", async () => {
    // React Native's Jest setup already mocks it; clear earlier calls.
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await render(
      <CategoryError
        error={apiError("RATE_LIMITED")}
        onRetry={() => undefined}
      />,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
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
