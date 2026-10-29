// next/link for unit tests (vitest.setup.ts mocks the module with this).
//
// The real <Link> renders an <a href> and, on a plain left click inside
// this tab, cancels the browser's page load and asks the App Router to
// navigate. Under Vitest there is no App Router, so the same rules send the
// navigation to the memory router: the link's own onClick runs first and
// may cancel it (preventDefault); a click with a modifier key, a link to
// another tab or a download, and an external URL are left to the browser.
import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";
import { testRouter } from "./memory-router.ts";

// Only the options the storefront passes; another (prefetch, scroll) would
// land on the <a> and React would warn about it, a hint to add it here.
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  replace?: boolean;
  ref?: Ref<HTMLAnchorElement>;
};

const isModified = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button !== 0 ||
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey;

const isLocal = (href: string) =>
  new URL(href, window.location.href).origin === window.location.origin;

export default function Link({
  href,
  replace = false,
  onClick,
  ...anchor
}: LinkProps) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || isModified(event)) return;
    const target = event.currentTarget.getAttribute("target");
    if (
      (target !== null && target !== "_self") ||
      anchor.download !== undefined
    )
      return;
    if (!isLocal(href)) return;
    event.preventDefault();
    if (replace) testRouter.replace(href);
    else testRouter.push(href);
  };
  return <a href={href} onClick={click} {...anchor} />;
}
