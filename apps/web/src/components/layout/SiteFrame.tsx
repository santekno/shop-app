"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AnalyticsConsent } from "@/features/analytics/components/AnalyticsConsent.tsx";
import { forgetNavigationStateUnless } from "@/lib/navigation-state.ts";
import { SiteHeader } from "./SiteHeader.tsx";
import { SkipLink } from "./SkipLink.tsx";
import { useRouteFocus } from "./useRouteFocus.ts";

/** The id of <main>, where the skip link goes. */
const MAIN_ID = "konten";

/**
 * The frame around every page: the skip link, the header, then the page.
 * The root layout (app/layout.tsx) renders it once; a layout is not
 * rendered again when the buyer moves between its pages, so the header
 * keeps its state and only `children` changes (React Router's <Outlet />
 * in Bab 9–10's RootLayout).
 *
 * A client component because it moves the focus after a navigation
 * (useRouteFocus). `children` can still be a server component: the server
 * renders it and passes the result through.
 *
 * `analytics` (artikel 13) says whether GA_MEASUREMENT_ID is set; the
 * root layout reads it on the server. Only then is there a footer, with
 * "Pengaturan analytics" and the consent banner.
 */
export function SiteFrame({
  children,
  analytics = false,
}: {
  children: ReactNode;
  analytics?: boolean;
}) {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  // State handed to a page lasts while that page is on screen.
  const pathname = usePathname();
  useEffect(() => {
    forgetNavigationStateUnless(pathname);
  }, [pathname]);

  return (
    <>
      {/* First in the document, so it is the first stop for Tab. */}
      <SkipLink targetId={MAIN_ID} />
      <SiteHeader />
      {/* tabIndex={-1}: the page can give <main> the focus from code
          (useRouteFocus), but Tab never stops on it. focus:outline-none
          because <main> only takes the focus from code (no ring needed). */}
      <main
        id={MAIN_ID}
        ref={mainRef}
        className="mx-auto max-w-page px-4 pt-6 pb-12 focus:outline-none"
        tabIndex={-1}
      >
        {children}
      </main>
      {analytics && (
        <footer className="mx-auto max-w-page px-4 pb-6">
          <AnalyticsConsent />
        </footer>
      )}
    </>
  );
}
