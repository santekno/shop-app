"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

type NavLinkProps = ComponentProps<typeof Link> & { href: string };

/**
 * A link that says when its page is the one on screen: aria-current="page"
 * (read out by a screen reader; the header's CSS makes it bold). React
 * Router's <NavLink> did this; Next.js' <Link> does not, so the current
 * path from usePathname() decides.
 */
export function NavLink({ href, ...props }: NavLinkProps) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      aria-current={pathname === href ? "page" : undefined}
      {...props}
    />
  );
}
