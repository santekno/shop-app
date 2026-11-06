import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import { SectionHeader } from "./SectionHeader";
import { SectionStatus } from "./SectionStatus";

describe("SectionStatus", () => {
  it("loading: a progressbar that names what is loading", async () => {
    await render(
      <SectionStatus
        view="loading"
        what="banner"
        error={null}
        onRetry={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("progressbar", { name: "Memuat banner…" }),
    ).toBeTruthy();
  });

  it("offline: says the section loads when the connection is back, capitalised", async () => {
    await render(
      <SectionStatus
        view="offline"
        what="produk unggulan"
        error={null}
        onRetry={jest.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Tidak ada koneksi internet. Produk unggulan dimuat begitu koneksi kembali.",
      ),
    ).toBeTruthy();
  });

  it("error: shows the failure and Coba lagi calls onRetry once", async () => {
    const onRetry = jest.fn();
    const error = new Error("boom");
    await render(
      <SectionStatus
        view="error"
        what="kategori"
        error={error}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeTruthy();
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("SectionHeader", () => {
  it("is a header with the title", async () => {
    await render(<SectionHeader title="Kategori" />);

    expect(screen.getByRole("header", { name: "Kategori" })).toBeTruthy();
  });
});
