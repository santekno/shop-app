import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { plain } from "@/test/text.ts";
import { TablePagination } from "./TablePagination.tsx";

type Props = ComponentProps<typeof TablePagination>;

const renderPagination = (overrides: Partial<Props> = {}) => {
  const props: Props = {
    page: 2,
    pageCount: 3,
    perPage: 20,
    total: 45,
    rowsOnPage: 20,
    busy: false,
    canPrevious: true,
    canNext: true,
    onFirst: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onLast: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  };
  render(<TablePagination {...props} />);
  return props;
};

const nav = () =>
  screen.getByRole("navigation", { name: "Halaman tabel produk" });

describe("TablePagination", () => {
  it("says which rows of how many are shown, and which page", () => {
    renderPagination();

    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Menampilkan 21–40 dari 45 produk",
    );
    expect(plain(nav().textContent)).toContain("Halaman 2 dari 3");
  });

  it("counts the rows of a short last page", () => {
    renderPagination({ page: 3, rowsOnPage: 5, canNext: false });

    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Menampilkan 41–45 dari 45 produk",
    );
  });

  it("writes large numbers the Indonesian way", () => {
    renderPagination({ page: 51, pageCount: 63, perPage: 20, total: 1_250 });

    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Menampilkan 1.001–1.020 dari 1.250 produk",
    );
  });

  it("says only the total for a page without rows", () => {
    renderPagination({ page: 9, rowsOnPage: 0 });

    expect(plain(screen.getByRole("status").textContent)).toBe("45 produk");
  });

  it("says it is loading while the next page is on its way", () => {
    renderPagination({ busy: true });

    expect(screen.getByRole("status")).toHaveTextContent("Memuat produk…");
  });

  it("calls each page button's handler", async () => {
    const user = userEvent.setup();
    const props = renderPagination();

    await user.click(
      within(nav()).getByRole("button", { name: "Halaman pertama" }),
    );
    await user.click(
      within(nav()).getByRole("button", { name: "Halaman sebelumnya" }),
    );
    await user.click(
      within(nav()).getByRole("button", { name: "Halaman berikutnya" }),
    );
    await user.click(
      within(nav()).getByRole("button", { name: "Halaman terakhir" }),
    );

    expect(props.onFirst).toHaveBeenCalledTimes(1);
    expect(props.onPrevious).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onLast).toHaveBeenCalledTimes(1);
  });

  it("disables backwards on the first page and forwards on the last", () => {
    renderPagination({ page: 1, canPrevious: false, canNext: true });

    expect(
      screen.getByRole("button", { name: "Halaman pertama" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Halaman sebelumnya" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Halaman berikutnya" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Halaman terakhir" }),
    ).toBeEnabled();
  });

  it("disables forwards on the last page", () => {
    renderPagination({ page: 3, canNext: false, rowsOnPage: 5 });

    expect(
      screen.getByRole("button", { name: "Halaman berikutnya" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Halaman terakhir" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Halaman sebelumnya" }),
    ).toBeEnabled();
  });

  it("hides the page buttons when nothing matches", () => {
    renderPagination({ page: 1, pageCount: 0, total: 0, rowsOnPage: 0 });

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("offers 10, 20, 50 and 100 rows and reports the choice", async () => {
    const user = userEvent.setup();
    const props = renderPagination();
    const select = screen.getByLabelText("Baris per halaman");

    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["10", "20", "50", "100"]);
    expect(select).toHaveValue("20");
    await user.selectOptions(select, "50");

    expect(props.onPageSizeChange).toHaveBeenCalledExactlyOnceWith(50);
  });
});
