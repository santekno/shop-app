"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Goes to `to` as soon as it renders, replacing the current history entry
 * (React Router's <Navigate replace>). For a decision only the browser can
 * make, such as "no session": the server never knows the session, which
 * lives in the browser (Bab 10). A redirect the server can decide is
 * redirect() from next/navigation instead.
 */
export function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
