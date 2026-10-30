import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button.tsx";

const classesOf = (element: HTMLElement) => [...element.classList];

describe("Button", () => {
  it("renders the link variant without a button box at the default size", () => {
    render(<Button variant="link">Lihat semua</Button>);

    const classes = classesOf(
      screen.getByRole("button", { name: "Lihat semua" }),
    );
    // The size's h-10 px-4 come after the variant's classes, so without
    // the compound variant they would win in tailwind-merge.
    expect(classes).toEqual(
      expect.arrayContaining(["h-auto", "px-0", "text-primary"]),
    );
    expect(classes).not.toContain("h-10");
    expect(classes).not.toContain("px-4");
  });

  it("keeps the link variant boxless at another size too", () => {
    render(
      <Button variant="link" size="sm">
        Ubah
      </Button>,
    );

    const classes = classesOf(screen.getByRole("button", { name: "Ubah" }));
    expect(classes).toEqual(expect.arrayContaining(["h-auto", "px-0"]));
    expect(classes).not.toContain("h-9");
    expect(classes).not.toContain("px-3");
  });

  it("keeps the link variant boxless when it renders its child", () => {
    render(
      <Button variant="link" asChild>
        <a href="/keranjang">Keranjang</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Keranjang" });
    expect(classesOf(link)).toEqual(expect.arrayContaining(["h-auto", "px-0"]));
    expect(classesOf(link)).not.toContain("h-10");
  });

  it.each([
    ["default", "bg-primary"],
    ["destructive", "bg-destructive"],
    ["outline", "border-input"],
    ["ghost", "hover:bg-accent"],
  ] as const)(
    "gives the %s variant its own colour and the default size's box",
    (variant, colour) => {
      render(<Button variant={variant}>Simpan</Button>);

      const classes = classesOf(screen.getByRole("button", { name: "Simpan" }));
      expect(classes).toEqual(
        expect.arrayContaining([colour, "h-10", "px-4", "py-2"]),
      );
      expect(classes).not.toContain("h-auto");
      expect(classes).not.toContain("px-0");
    },
  );

  it.each([
    ["sm", ["h-9", "px-3"]],
    ["icon", ["size-10"]],
  ] as const)("applies the %s size", (size, expected) => {
    render(<Button size={size}>Ikon</Button>);

    const classes = classesOf(screen.getByRole("button", { name: "Ikon" }));
    expect(classes).toEqual(expect.arrayContaining([...expected]));
    expect(classes).not.toContain("h-10");
  });

  it("is type=button unless told otherwise, and lets a caller's class win", () => {
    render(
      <>
        <Button className="w-full px-6">Batal</Button>
        <Button type="submit">Kirim</Button>
      </>,
    );

    const cancel = screen.getByRole("button", { name: "Batal" });
    expect(cancel.getAttribute("type")).toBe("button");
    expect(classesOf(cancel)).toEqual(
      expect.arrayContaining(["w-full", "px-6"]),
    );
    expect(classesOf(cancel)).not.toContain("px-4");
    expect(
      screen.getByRole("button", { name: "Kirim" }).getAttribute("type"),
    ).toBe("submit");
  });
});
