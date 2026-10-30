import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StepIndicator } from "./StepIndicator.tsx";

const steps = [
  { title: "Info dasar" },
  { title: "Varian & harga" },
  { title: "Tinjau" },
];

describe("StepIndicator", () => {
  it("names each step with its number, marks the current one and the ones done", () => {
    render(<StepIndicator steps={steps} current={1} onSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", {
      name: "Langkah formulir produk",
    });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Langkah 1: Info dasar (selesai)",
      "2Langkah 2: Varian & harga",
      "3Langkah 3: Tinjau",
    ]);
    expect(buttons[1]).toHaveAttribute("aria-current", "step");
    expect(buttons[0]).not.toHaveAttribute("aria-current");
    expect(buttons[2]).not.toHaveAttribute("aria-current");
  });

  it("asks the form to go to the chosen step, which decides", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<StepIndicator steps={steps} current={0} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Tinjau/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.getByRole("button", { name: /Info dasar/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});
