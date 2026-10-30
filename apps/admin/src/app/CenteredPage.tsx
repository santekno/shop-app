import type { ReactNode } from "react";
import { MAIN_ID } from "./useRouteFocus.ts";

/**
 * The frame of the pages outside the dashboard: the login form, the
 * "no access" page, the start-up check and an error before the dashboard
 * could render. No header, no sidebar: only <main>, with the content in a
 * narrow column in the middle of the screen.
 *
 * <main> has the same id as the dashboard's, so useRouteFocus finds the
 * heading of whichever layout is on screen.
 */
export function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <main
      id={MAIN_ID}
      tabIndex={-1}
      className="grid min-h-dvh place-items-center p-4 focus:outline-none"
    >
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
