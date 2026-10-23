import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { rupiah, variant } from "@/test/fake-api.ts";
import { VariantPicker } from "./VariantPicker.tsx";

const variants = [
  variant("m", { name: "M", stock: 3 }),
  variant("l", { name: "L", stock: 0 }),
  variant("xl", {
    name: "XL",
    stock: 12,
    price: { amount: 99_000, currency: "IDR" },
  }),
];

const radios = () => screen.getAllByRole<HTMLInputElement>("radio");

describe("VariantPicker", () => {
  it("renders one radio per variant in a group named Pilih varian", () => {
    render(
      <VariantPicker variants={variants} selectedId="m" onSelect={vi.fn()} />,
    );

    const group = screen.getByRole("group", { name: "Pilih varian" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    const names = new Set(radios().map((radio) => radio.name));
    expect(names.size).toBe(1);
    expect([...names][0]).not.toBe("");
  });

  it("gives each picker its own group name", () => {
    render(
      <>
        <VariantPicker variants={variants} selectedId="m" onSelect={vi.fn()} />
        <VariantPicker variants={variants} selectedId="l" onSelect={vi.fn()} />
      </>,
    );

    expect(new Set(radios().map((radio) => radio.name)).size).toBe(2);
  });

  it("shows each variant's name, price and stock, or stok habis", () => {
    render(
      <VariantPicker variants={variants} selectedId="m" onSelect={vi.fn()} />,
    );

    expect(
      radios().map((radio) => radio.closest("label")?.textContent),
    ).toEqual([
      `M${rupiah(89_000)} · stok 3`,
      `L${rupiah(89_000)} · stok habis`,
      `XL${rupiah(99_000)} · stok 12`,
    ]);
  });

  it("checks the variant selectedId names, following the prop", () => {
    const { rerender } = render(
      <VariantPicker variants={variants} selectedId="m" onSelect={vi.fn()} />,
    );
    expect(radios().map((radio) => radio.checked)).toEqual([
      true,
      false,
      false,
    ]);

    rerender(
      <VariantPicker variants={variants} selectedId="xl" onSelect={vi.fn()} />,
    );
    expect(radios().map((radio) => radio.checked)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("reports the picked variant's id and leaves checked to the parent", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <VariantPicker variants={variants} selectedId="m" onSelect={onSelect} />,
    );

    await user.click(screen.getByRole("radio", { name: /^XL/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("xl");
    // Controlled: the parent did not change selectedId, so M stays checked.
    expect(radios().map((radio) => radio.checked)).toEqual([
      true,
      false,
      false,
    ]);
  });
});
