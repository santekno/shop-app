// The wishlist's saved slugs as a plain list, and the one pure function
// that changes it. Kept free of React and of the network so the rule can be
// read (and checked) on its own.

/**
 * `slugs` after saving (`saved: true`) or removing (`saved: false`) `slug`.
 * A save puts it first (the API lists the newest saved first) and never
 * twice; a removal of a slug that is not there changes nothing. Returns the
 * same array when nothing changes, so TanStack Query's structural sharing
 * keeps every heart from re-rendering for nothing. `undefined` is a list
 * that has not loaded yet, treated as empty.
 */
export const applyToggle = (
  slugs: readonly string[] | undefined,
  slug: string,
  saved: boolean,
): readonly string[] => {
  const before = slugs ?? [];
  const has = before.includes(slug);
  if (saved) return has ? before : [slug, ...before];
  return has ? before.filter((s) => s !== slug) : before;
};
