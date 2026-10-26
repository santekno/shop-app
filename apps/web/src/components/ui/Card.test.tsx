import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card.tsx";

describe("Card", () => {
  it("renders a div with the card class around its children by default", () => {
    const { container } = render(
      <Card>
        <p>Isi</p>
      </Card>,
    );

    const card = container.firstElementChild;
    expect(card?.tagName).toBe("DIV");
    expect(card?.className).toBe("card");
    expect(card?.hasAttribute("aria-labelledby")).toBe(false);
    expect(screen.getByText("Isi").parentElement).toBe(card);
  });

  it.each(["section", "article"] as const)(
    "renders as a <%s> when asked",
    (as) => {
      const { container } = render(<Card as={as}>x</Card>);

      expect(container.firstElementChild?.tagName).toBe(as.toUpperCase());
    },
  );

  it("adds a className after card and points aria-labelledby at a heading", () => {
    render(
      <Card as="section" className="catalog__products" labelledBy="h">
        <h2 id="h">Produk</h2>
      </Card>,
    );

    const region = screen.getByRole("region", { name: "Produk" });
    expect(region.className).toBe("card catalog__products");
    expect(region.getAttribute("aria-labelledby")).toBe("h");
  });
});
