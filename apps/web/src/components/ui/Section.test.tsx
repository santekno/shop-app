import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Section } from "./Section.tsx";

describe("Section", () => {
  it("renders a card section named by its h2", () => {
    render(
      <Section title="Produk" className="catalog__products">
        <p>Isi</p>
      </Section>,
    );

    const region = screen.getByRole("region", { name: "Produk" });
    expect(region.tagName).toBe("SECTION");
    expect(region.className).toBe("card catalog__products");
    const heading = screen.getByRole("heading", { level: 2, name: "Produk" });
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(region.contains(screen.getByText("Isi"))).toBe(true);
  });

  it("gives every section its own heading id", () => {
    render(
      <>
        <Section title="Kategori">a</Section>
        <Section title="Produk">b</Section>
      </>,
    );

    const ids = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.id);
    expect(ids.every((id) => id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(2);
    expect(screen.getByRole("region", { name: "Kategori" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Produk" })).toBeTruthy();
  });
});
