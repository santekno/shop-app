// The banner's background comes from the API as #RRGGBB, and the text on
// it has to stay readable whatever the shop picked.

/** The primary colour (src/theme/colors.js), used when the API's is not #RRGGBB. */
export const FALLBACK_BANNER_COLOR = "#0b5cad";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** `value` if it is #RRGGBB, else the fallback: a bad colour must not crash a card. */
export const bannerBackground = (value: string): string =>
  HEX_COLOR.test(value) ? value : FALLBACK_BANNER_COLOR;

/** WCAG relative luminance of a #RRGGBB colour, 0 (black) to 1 (white). */
const luminance = (hex: string): number => {
  const channel = (start: number) => {
    const v = parseInt(hex.slice(start, start + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

/** White on a dark background, near-black on a light one. */
export const bannerForeground = (background: string): string =>
  luminance(bannerBackground(background)) > 0.4 ? "#1f2328" : "#ffffff";
