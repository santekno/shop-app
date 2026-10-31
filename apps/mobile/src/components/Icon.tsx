// The one place the app draws an icon. Screens name an icon by what it
// means ("keranjang"), not by a glyph in some icon set, so changing the
// set touches this file only, which is what artikel 11 did: from the
// Ionicons font (@expo/vector-icons) to SVG drawings of Lucide's icons,
// the set apps/web and apps/admin use through lucide-react, so the app
// and the website show the same cart and the same magnifier.
//
// Why SVG rather than a font, measured with `pnpm build` (expo export):
// Ionicons is one 390 KB font file holding 1,357 glyphs, of which the app
// used 14 (seven icons, filled and outlined), loaded at run time before an
// icon can draw; react-native-svg plus these paths add about 114 KB of
// bytecode per platform and load nothing. The drawings are paths in this
// file, not an icon package, so only the icons used ship.
//
// The paths below are Lucide's (https://lucide.dev), 24 × 24, 2-unit
// stroke, round caps. Lucide is under the ISC License:
//
//   Copyright (c) 2026 Lucide Icons and Contributors. Permission to use,
//   copy, modify, and/or distribute this software for any purpose with or
//   without fee is hereby granted, provided that the above copyright
//   notice and this permission notice appear in all copies. THE SOFTWARE
//   IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
//   REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
//   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
//   FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
//   DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
//   WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
//   ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
//   SOFTWARE.
import { cssInterop } from "nativewind";
import type { ReactElement } from "react";
import type { ColorValue } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

// Svg knows nothing of className. This teaches NativeWind to read one on
// it and to hand the colour of a text-* class to Svg's `color` prop, which
// the shapes draw with (stroke="currentColor"). So an icon takes its
// colour either from a class (`text-primary dark:text-primary-dark`) or,
// where a navigator hands one over (the tab bar), from `color`.
const TintedSvg = cssInterop(Svg, {
  className: { target: "style", nativeStyleToProp: { color: true } },
});

const SHAPES = {
  // house
  beranda: (
    <>
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  // layout-grid. Lucide draws four <rect>s; they are written as paths
  // because react-native-svg's types mark Rect's x and y as deprecated
  // (they collide with the transform props of the same name).
  kategori: (
    <>
      <Path d="M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" />
      <Path d="M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" />
      <Path d="M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" />
      <Path d="M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" />
    </>
  ),
  // shopping-cart
  keranjang: (
    <>
      <Path d="m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18" />
      <Path d="M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25" />
      <Circle cx="18" cy="20" r="2" />
      <Circle cx="8" cy="20" r="2" />
    </>
  ),
  // user
  akun: (
    <>
      <Path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <Circle cx="12" cy="7" r="4" />
    </>
  ),
  // arrow-up-down
  urutkan: (
    <>
      <Path d="m21 16-4 4-4-4" />
      <Path d="M17 20V4" />
      <Path d="m3 8 4-4 4 4" />
      <Path d="M7 4v16" />
    </>
  ),
  // search
  cari: (
    <>
      <Path d="m21 21-4.34-4.34" />
      <Circle cx="11" cy="11" r="8" />
    </>
  ),
  // check
  terpilih: <Path d="M20 6 9 17l-5-5" />,
  // chevron-right: a row that opens another screen
  lanjut: <Path d="m9 18 6-6-6-6" />,
  // x: removes something, such as the catalog's category filter
  tutup: (
    <>
      <Path d="M18 6 6 18" />
      <Path d="m6 6 12 12" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof SHAPES;

interface IconProps {
  name: IconName;
  /** A colour value, for callers that are handed one (the tab bar). */
  color?: ColorValue;
  /** Or a text-* class with its dark: twin, like any Text. */
  className?: string;
  size?: number;
  /**
   * The emphasised form, for a selected tab or a chosen option: a heavier
   * stroke. Lucide draws outlines only, so "filled" is weight, not fill.
   */
  filled?: boolean;
}

/**
 * A decorative icon: screen readers skip it, so whatever it sits in (a tab,
 * a button) carries the label.
 */
export function Icon({
  name,
  color,
  className,
  size = 24,
  filled = false,
}: IconProps) {
  return (
    <TintedSvg
      className={className}
      // React Native's ColorValue also admits a number and null, which
      // react-native-svg's types do not; the tab bar always passes a string.
      color={typeof color === "number" || color === null ? undefined : color}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={filled ? 2.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {SHAPES[name]}
    </TintedSvg>
  );
}
