import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "./Textarea.tsx";

describe("Textarea", () => {
  it("passes its props on and lets the caller's classes win", () => {
    render(
      <Textarea
        aria-label="Catatan"
        rows={3}
        className="min-h-10"
        defaultValue="halo"
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "Catatan" });
    expect(textarea).toHaveValue("halo");
    expect(textarea).toHaveAttribute("rows", "3");
    expect(textarea).toHaveClass("min-h-10");
    expect(textarea).not.toHaveClass("min-h-28");
  });
});
