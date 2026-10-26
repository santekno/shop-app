import type { MouseEvent } from "react";

interface SkipLinkProps {
  /** The id of the element the link skips to: the page's <main>. */
  targetId: string;
}

/**
 * "Langsung ke konten utama": the first thing Tab reaches on every page.
 *
 * A keyboard or switch user would otherwise tab through the logo, the
 * navigation and the theme toggle on every page before reaching the
 * content. The link sits above the top of the screen and slides in when
 * it has the focus, so sighted keyboard users see where they are.
 *
 * The click moves the focus itself instead of letting the browser follow
 * the #fragment: a fragment would add a history entry (Back would stop at
 * "#konten" first), and the router would treat it as a navigation. The
 * href stays, so the link still works without JavaScript and reads as a
 * link.
 */
export function SkipLink({ targetId }: SkipLinkProps) {
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (target === null) return;
    event.preventDefault();
    // <main> has tabIndex={-1}: it takes the focus, and the next Tab goes
    // to the first link or button inside it.
    target.focus();
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={skip}
      className="fixed top-2 left-2 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus:translate-y-0 motion-safe:transition-transform"
    >
      Langsung ke konten utama
    </a>
  );
}
