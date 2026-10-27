import type { Metadata } from "next";

/** The shop's name, in titles, Open Graph and structured data. */
export const SITE_NAME = "GoShop";

/** The default description of a page that has none of its own. */
export const SITE_DESCRIPTION =
  "GoShop: toko online contoh dari kursus Fullstack Santekno.";

/**
 * Open Graph fields every page shares. Next.js merges metadata one
 * top-level key at a time: a page that sets `openGraph` replaces the
 * layout's whole object, so pages spread these into theirs.
 */
export const baseOpenGraph = {
  siteName: SITE_NAME,
  locale: "id_ID",
  type: "website",
} as const satisfies NonNullable<Metadata["openGraph"]>;

/**
 * A description of at most `max` characters (search results cut around
 * 155–160), ending on a whole word with "…" when it had to be shortened.
 */
export const summary = (text: string, max = 160): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};
