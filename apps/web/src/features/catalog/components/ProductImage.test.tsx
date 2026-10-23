import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductImage } from "./ProductImage.tsx";

describe("ProductImage", () => {
  it.each([
    ["no src", undefined],
    ["an empty src", ""],
  ])("shows a placeholder hidden from screen readers for %s", (_, src) => {
    const { container } = render(<ProductImage name="Kaos Polos" src={src} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    const placeholder = screen.getByText("Belum ada foto").parentElement;
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
    expect(placeholder?.querySelector("svg")).not.toBeNull();
  });

  it("shows the photo named after the product, loaded lazily", () => {
    render(
      <ProductImage name="Kaos Polos" src="https://cdn.example.com/kaos.jpg" />,
    );

    const image = screen.getByRole("img", { name: "Kaos Polos" });
    expect(image.getAttribute("src")).toBe("https://cdn.example.com/kaos.jpg");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(screen.queryByText("Belum ada foto")).toBeNull();
  });
});
