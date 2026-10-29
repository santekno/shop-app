import { render, screen } from "@testing-library/react";
import type { ProductImage as Photo } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { ProductImage } from "./ProductImage.tsx";

const SIZES = "50vw";

const photo = (overrides: Partial<Photo> = {}): Photo => ({
  id: "img-1",
  url: "https://cdn.example.com/kaos/800.jpg",
  alt: "",
  width: 800,
  height: 800,
  variants: [
    { width: 800, height: 800, url: "https://cdn.example.com/kaos/800.jpg" },
    { width: 400, height: 400, url: "https://cdn.example.com/kaos/400.jpg" },
  ],
  ...overrides,
});

describe("ProductImage", () => {
  it("shows a placeholder hidden from screen readers when there is no photo", () => {
    const { container } = render(
      <ProductImage image={undefined} productName="Kaos Polos" sizes={SIZES} />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    const placeholder = screen.getByText("Belum ada foto").parentElement;
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
    expect(placeholder?.querySelector("svg")).not.toBeNull();
  });

  it("shows the photo named after the product, loaded lazily", () => {
    render(
      <ProductImage image={photo()} productName="Kaos Polos" sizes={SIZES} />,
    );

    const image = screen.getByRole("img", { name: "Kaos Polos" });
    expect(image.getAttribute("src")).toBe(
      "https://cdn.example.com/kaos/800.jpg",
    );
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(screen.queryByText("Belum ada foto")).toBeNull();
  });

  it("names the photo with its own alt text when it has one", () => {
    render(
      <ProductImage
        image={photo({ alt: "Kaos hitam dilipat" })}
        productName="Kaos Polos"
        sizes={SIZES}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Kaos hitam dilipat" }),
    ).toBeTruthy();
  });
});
