import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./SiteHeader.tsx";

describe("SiteHeader", () => {
  it("names the page GoShop in the h1, through a button", () => {
    render(<SiteHeader onHome={vi.fn()} />);

    const heading = screen.getByRole("heading", { level: 1, name: "GoShop" });
    const brand = screen.getByRole("button", { name: "GoShop" });
    expect(heading.contains(brand)).toBe(true);
    expect(brand.getAttribute("type")).toBe("button");
    expect(screen.getByRole("banner").contains(heading)).toBe(true);
    expect(
      screen.getByText("Toko online contoh dari kursus Fullstack Santekno."),
    ).toBeTruthy();
  });

  it("calls onHome when the brand is clicked", async () => {
    const user = userEvent.setup();
    const onHome = vi.fn();
    render(<SiteHeader onHome={onHome} />);

    await user.click(screen.getByRole("button", { name: "GoShop" }));

    expect(onHome).toHaveBeenCalledTimes(1);
  });
});
