import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductThumbnail } from "./ProductThumbnail.tsx";

describe("ProductThumbnail", () => {
  it("shows the photo as decoration, its size reserved", () => {
    const { container } = render(
      <ProductThumbnail url="http://storage.test/p-400.jpg" />,
    );

    // alt="" takes the image out of the accessibility tree: no img role.
    expect(screen.queryByRole("img")).toBeNull();
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "http://storage.test/p-400.jpg");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "40");
    expect(img).toHaveAttribute("height", "40");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("says there is no photo yet when there is none", () => {
    const { container } = render(<ProductThumbnail url={null} />);

    expect(screen.getByText("Belum ada foto")).toHaveClass("sr-only");
    expect(container.querySelector("img")).toBeNull();
  });
});
