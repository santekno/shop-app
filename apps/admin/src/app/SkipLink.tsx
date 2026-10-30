import type { MouseEvent } from "react";
import { MAIN_ID } from "./useRouteFocus.ts";

/**
 * "Langsung ke konten utama": the first thing Tab reaches on every
 * dashboard page. Without it a keyboard user tabs through the header and
 * every sidebar link on each page before reaching the content. The
 * storefront's skip link (Bab 10 artikel 07).
 *
 * The click moves the focus itself instead of following the #fragment: a
 * fragment would add a history entry and look like a navigation to the
 * router. The href stays, so it still reads as a link.
 */
export function SkipLink() {
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(MAIN_ID);
    if (target === null) return;
    event.preventDefault();
    // <main> has tabIndex={-1}: it takes the focus, and the next Tab goes
    // to the first link or button inside it.
    target.focus();
  };

  return (
    <a
      href={`#${MAIN_ID}`}
      onClick={skip}
      className="fixed top-2 left-2 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus:translate-y-0 motion-safe:transition-transform"
    >
      Langsung ke konten utama
    </a>
  );
}
