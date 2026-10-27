"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Redirect } from "@/components/navigation/Redirect.tsx";
import { LoadingState } from "@/components/ui/StatusMessage.tsx";
import { loginPathFor } from "../return-to.ts";
import { useSession } from "../session-context.ts";

/**
 * Around the pages that need a login (/akun, /checkout, /pesanan…): the
 * layout of the (akun) route group renders it (app/(akun)/layout.tsx).
 * It adds no markup of its own; it only decides whether its children may
 * render. A client component: the session lives in the browser, so only
 * the browser can decide (the server always renders "restoring").
 *
 * - "restoring": the start-up refresh has not answered yet. Deciding now
 *   would send a logged-in buyer who reloads /akun to the login form, so
 *   it waits.
 * - "anonymous": to /masuk, with the page asked for in `kembali`, so the
 *   login can come back to it. `replace`: Back from the login form goes
 *   to the page before, not to /akun, which would redirect again.
 * - "authenticated": the page.
 *
 * This is about what the buyer sees, not about security: the API refuses
 * every protected request without a valid token anyway. A redirect only
 * saves the buyer a page full of 401 errors.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (status === "restoring") {
    return <LoadingState>Memeriksa sesi Anda…</LoadingState>;
  }
  if (status === "anonymous") {
    // "anonymous" only ever happens in the browser, after the restore.
    const search = searchParams.toString();
    const here = `${pathname}${search === "" ? "" : `?${search}`}${window.location.hash}`;
    return <Redirect to={loginPathFor(here)} />;
  }
  return children;
}
