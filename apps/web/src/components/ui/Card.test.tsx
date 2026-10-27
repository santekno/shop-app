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
    // shadcn/ui's card, from the design tokens: a bordered card surface.
    expect([...(card?.classList ?? [])]).toEqual(
      expect.arrayContaining(["rounded-lg", "border", "bg-card", "p-4"]),
    );
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

  it("adds a className after its own and points aria-labelledby at a heading", () => {
    render(
      <Card as="section" className="catalog__products" labelledBy="h">
        <h2 id="h">Produk</h2>
      </Card>,
    );

    const region = screen.getByRole("region", { name: "Produk" });
    expect(region.classList.contains("bg-card")).toBe(true);
    expect(region.className.endsWith(" catalog__products")).toBe(true);
    expect(region.getAttribute("aria-labelledby")).toBe("h");
  });

  it("lets the caller's utility win over its own for the same property", () => {
    const { container } = render(<Card className="p-3">x</Card>);

    const card = container.firstElementChild;
    expect(card?.classList.contains("p-3")).toBe(true);
    expect(card?.classList.contains("p-4")).toBe(false);
    expect(card?.classList.contains("bg-card")).toBe(true);
  });
});
