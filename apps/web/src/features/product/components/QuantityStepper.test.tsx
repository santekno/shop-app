import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuantityStepper } from "./QuantityStepper.tsx";

const decrease = () => screen.getByRole("button", { name: "Kurangi jumlah" });
const increase = () => screen.getByRole("button", { name: "Tambah jumlah" });

describe("QuantityStepper", () => {
  it("shows the value and the maximum in a group labelled Jumlah", () => {
    render(<QuantityStepper value={3} max={7} onChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: "Jumlah" });
    expect(group.querySelector("output")?.textContent).toBe("3");
    expect(screen.getByText("Maks. 7")).toBeTruthy();
  });

  it("takes another label", () => {
    render(
      <QuantityStepper
        value={1}
        max={2}
        onChange={vi.fn()}
        label="Banyaknya"
      />,
    );

    expect(screen.getByRole("group", { name: "Banyaknya" })).toBeTruthy();
  });

  it("reports value - 1 and value + 1", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityStepper value={3} max={7} onChange={onChange} />);

    await user.click(decrease());
    await user.click(increase());

    expect(onChange.mock.calls).toEqual([[2], [4]]);
  });

  it("disables Kurangi jumlah at 1", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityStepper value={1} max={7} onChange={onChange} />);

    expect((decrease() as HTMLButtonElement).disabled).toBe(true);
    expect((increase() as HTMLButtonElement).disabled).toBe(false);
    await user.click(decrease());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables Tambah jumlah at the maximum", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityStepper value={7} max={7} onChange={onChange} />);

    expect((increase() as HTMLButtonElement).disabled).toBe(true);
    expect((decrease() as HTMLButtonElement).disabled).toBe(false);
    await user.click(increase());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables both when the maximum is 1", () => {
    render(<QuantityStepper value={1} max={1} onChange={vi.fn()} />);

    expect((decrease() as HTMLButtonElement).disabled).toBe(true);
    expect((increase() as HTMLButtonElement).disabled).toBe(true);
  });
});
