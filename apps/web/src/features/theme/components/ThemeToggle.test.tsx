import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { stubColorScheme } from "@/test/match-media.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

describe("ThemeToggle", () => {
  it("is one button named Mode gelap that says on or off with aria-pressed", async () => {
    const events = userEvent.setup();
    stubColorScheme("light");
    render(<ThemeToggle />);

    const toggle = screen.getByRole("button", { name: "Mode gelap" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await events.click(toggle);

    // The same button, the same name; only the state changed.
    expect(screen.getByRole("button", { name: "Mode gelap" })).toBe(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("dark");

    await events.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("starts pressed on a dark device", () => {
    stubColorScheme("dark");
    render(<ThemeToggle />);

    expect(
      screen
        .getByRole("button", { name: "Mode gelap" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("hides its icon from screen readers", () => {
    stubColorScheme("light");
    render(<ThemeToggle />);

    const icon = screen
      .getByRole("button", { name: "Mode gelap" })
      .querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});
