import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./Progress.tsx";

describe("Progress", () => {
  it("is a named progress bar with its value and maximum", () => {
    render(<Progress value={40} max={100} aria-label="Mengunggah kaos.jpg" />);

    const bar = screen.getByRole("progressbar", {
      name: "Mengunggah kaos.jpg",
    });
    expect(bar.tagName).toBe("PROGRESS");
    expect(bar).toHaveAttribute("value", "40");
    expect(bar).toHaveAttribute("max", "100");
  });

  it("keeps its own look and adds the caller's classes", () => {
    render(<Progress value={1} aria-label="x" className="h-3" />);

    const bar = screen.getByRole("progressbar", { name: "x" });
    expect(bar).toHaveClass("h-3", "w-full", "rounded-full");
    expect(bar).not.toHaveClass("h-2");
  });
});
