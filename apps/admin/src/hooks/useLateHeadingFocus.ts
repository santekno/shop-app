import { useEffect, useRef } from "react";

/**
 * For a page heading that appears after the page did: a product that was
 * still loading, or an error found by that load.
 *
 * After a navigation, useRouteFocus focuses the page's <h1>; when there was
 * none yet, it focused <main>. Once this heading mounts, it takes the focus
 * over from <main>. Only from <main>: a user who has already moved on
 * keeps the focus where it is, and so does a fresh page load (focus on
 * <body>).
 *
 * @example
 *   const headingRef = useLateHeadingFocus();
 *   return <h1 ref={headingRef} tabIndex={-1}>…</h1>;
 */
export const useLateHeadingFocus = () => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (document.activeElement?.tagName === "MAIN") {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, []);
  return headingRef;
};
