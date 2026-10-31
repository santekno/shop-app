import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import type { ColorValue } from "react-native";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

/** The drawing: the native SVG view and its group of shapes. */
const svg = () => {
  const [view] = screen.container.queryAll((i) => i.type === "RNSVGSvgView");
  if (view === undefined) throw new Error("no svg drawn");
  return view;
};
const shapes = () =>
  svg().queryAll((i) => i.type === "RNSVGPath" || i.type === "RNSVGCircle");

const NAMES: IconName[] = [
  "beranda",
  "kategori",
  "keranjang",
  "akun",
  "urutkan",
  "cari",
  "terpilih",
  "lanjut",
  "tutup",
];

describe("Icon", () => {
  it.each(NAMES)(
    "draws %s as Lucide strokes on a 24-unit grid",
    async (name) => {
      await render(<Icon name={name} />);

      // viewBox="0 0 24 24", as react-native-svg hands it to the native view.
      expect(svg().props).toMatchObject({
        minX: 0,
        minY: 0,
        vbWidth: 24,
        vbHeight: 24,
      });
      expect(svg()).toHaveProp("fill", "none");
      expect(svg()).toHaveProp("stroke", "currentColor");
      expect(shapes().length).toBeGreaterThan(0);
    },
  );

  it("draws a different shape for each name", async () => {
    const drawings = new Set<string>();
    for (const name of NAMES) {
      await render(<Icon name={name} />);
      drawings.add(
        JSON.stringify(
          shapes().map((shape) => {
            const { d, cx, cy, r } = shape.props as Record<string, unknown>;
            return d ?? [cx, cy, r];
          }),
        ),
      );
    }
    expect(drawings.size).toBe(NAMES.length);
  });

  it("is 24 by default and takes a size", async () => {
    await render(<Icon name="cari" />);
    expect(svg()).toHaveProp("width", 24);
    expect(svg()).toHaveProp("height", 24);

    await screen.rerender(<Icon name="cari" size={18} />);
    expect(svg()).toHaveProp("width", 18);
    expect(svg()).toHaveProp("height", 18);
  });

  it("draws the outline with a 2-unit stroke, and a heavier one when filled", async () => {
    await render(<Icon name="beranda" />);
    expect(svg()).toHaveProp("strokeWidth", 2);

    await screen.rerender(<Icon name="beranda" filled />);
    expect(svg()).toHaveProp("strokeWidth", 2.5);
  });

  it("passes a colour string on", async () => {
    await render(<Icon name="akun" color="#0b5cad" />);
    expect(svg()).toHaveProp("color", "#0b5cad");
  });

  it.each([
    ["a number", 0xff0000ff],
    ["null", null],
  ])("drops %s, which react-native-svg cannot take", async (_name, color) => {
    await render(<Icon name="akun" color={color as ColorValue} />);
    expect(svg().props.color).toBeUndefined();
  });

  it("is hidden from screen readers: its container carries the label", async () => {
    await render(<Icon name="keranjang" />);
    expect(svg()).toHaveProp("accessibilityElementsHidden", true);
    expect(svg()).toHaveProp(
      "importantForAccessibility",
      "no-hide-descendants",
    );
    expect(svg()).not.toBeVisible();
  });
});
