import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { ApiError } from "@goshop/shared";

import { ProductListFooter } from "./ProductListFooter";

const idle = {
  count: 20,
  hasNextPage: true,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  error: null,
  fetchNextPage: () => undefined,
};

const failed = new ApiError({
  status: 503,
  code: "UNAVAILABLE",
  message: "x",
  requestId: "req-7",
});

describe("ProductListFooter", () => {
  it("shows the next page loading", async () => {
    await render(<ProductListFooter {...idle} isFetchingNextPage />);
    expect(
      screen.getByRole("progressbar", { name: "Memuat produk berikutnya…" }),
    ).toBeOnTheScreen();
  });

  it("prefers loading over an old error: a retry is running", async () => {
    await render(
      <ProductListFooter
        {...idle}
        isFetchingNextPage
        isFetchNextPageError
        error={failed}
      />,
    );
    expect(screen.getByRole("progressbar")).toBeOnTheScreen();
    expect(screen.queryByText("Kode permintaan: req-7")).not.toBeOnTheScreen();
  });

  it("shows a failed next page with its request ID and a retry", async () => {
    const fetchNextPage = jest.fn();
    await render(
      <ProductListFooter
        {...idle}
        isFetchNextPageError
        error={failed}
        fetchNextPage={fetchNextPage}
      />,
    );

    expect(screen.getByText("Kode permintaan: req-7")).toBeOnTheScreen();
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("says the end is reached when there is no next page", async () => {
    await render(<ProductListFooter {...idle} hasNextPage={false} count={3} />);
    expect(
      screen.getByText("Semua produk sudah ditampilkan."),
    ).toBeOnTheScreen();
  });

  it("is empty for an empty list (the list says that itself)", async () => {
    await render(<ProductListFooter {...idle} hasNextPage={false} count={0} />);
    expect(screen.toJSON()).toBeNull();
  });

  it("is empty while more pages wait to be asked for", async () => {
    await render(<ProductListFooter {...idle} />);
    expect(screen.toJSON()).toBeNull();
  });
});
