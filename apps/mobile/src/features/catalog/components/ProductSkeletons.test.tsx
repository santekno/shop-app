import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import {
  FeaturedSkeleton,
  ProductCardSkeleton,
  ProductDetailSkeleton,
  ProductGridSkeleton,
} from "./ProductSkeletons";

const cells = (className: string) =>
  screen.container.queryAll((i) => i.props.className === className);

describe("ProductSkeletons", () => {
  it("the grid is a progressbar 'Memuat produk…' with six two-column cards by default", async () => {
    await render(<ProductGridSkeleton />);

    expect(
      screen.getByRole("progressbar", { name: "Memuat produk…" }),
    ).toBeTruthy();
    expect(cells("w-1/2 p-1.5")).toHaveLength(6);
  });

  it("the grid draws as many cards as asked", async () => {
    await render(<ProductGridSkeleton count={2} />);

    expect(cells("w-1/2 p-1.5")).toHaveLength(2);
  });

  it("the featured row is 'Memuat produk unggulan…' with three 176 dp cells", async () => {
    await render(<FeaturedSkeleton />);

    expect(
      screen.getByRole("progressbar", { name: "Memuat produk unggulan…" }),
    ).toBeTruthy();
    expect(cells("w-44 p-1.5")).toHaveLength(3);
  });

  it("the detail skeleton is 'Memuat produk…' too", async () => {
    await render(<ProductDetailSkeleton />);

    expect(
      screen.getByRole("progressbar", { name: "Memuat produk…" }),
    ).toBeTruthy();
  });

  it("a card skeleton is hidden from screen readers (the group speaks for it)", async () => {
    await render(<ProductCardSkeleton />);

    const hidden = screen.container.queryAll(
      (i) => i.props.importantForAccessibility === "no-hide-descendants",
    );
    expect(hidden).toHaveLength(4);
  });
});
