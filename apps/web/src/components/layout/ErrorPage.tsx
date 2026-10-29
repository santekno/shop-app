"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { useLateHeadingFocus } from "@/hooks/useLateHeadingFocus.ts";
import { errorRequestId } from "@/lib/error-message.ts";
import { reportCaughtError } from "@/lib/report-error.ts";

interface ErrorPageProps {
  /**
   * What was thrown. An error thrown on the server reaches the browser
   * without its message in production (Next.js keeps it in the server's
   * log and sends a `digest` to match the two); an error thrown in the
   * browser arrives whole, an ApiError with its request ID included.
   */
  error: Error & { digest?: string };
}

/**
 * What renders instead of a page that threw while rendering (app/error.tsx,
 * Bab 9–10's RouteErrorPage). A missing product is not an error here: the
 * product page calls notFound(), which shows app/not-found.tsx with a real
 * 404 status.
 *
 * Anything that reaches this page is a bug or a failed download, not
 * something the buyer did. It offers a reload: after a new deploy, the old
 * page asks for code files that no longer exist, and a reload fetches the
 * new ones. Next.js resets the boundary on the next navigation, so any
 * link or Back leaves the error behind.
 */
export function ErrorPage({ error }: ErrorPageProps) {
  const requestId = errorRequestId(error) ?? error.digest;
  const headingRef = useLateHeadingFocus();

  // Reported once, here (React would log it too in development).
  useEffect(() => {
    reportCaughtError(error);
  }, [error]);

  return (
    <div className="grid gap-4" role="alert">
      {/* React 19 moves a <title> rendered anywhere into <head>. */}
      <title>Terjadi kesalahan — GoShop</title>
      <h1 ref={headingRef} tabIndex={-1}>
        Terjadi kesalahan
      </h1>
      <p>
        Halaman ini gagal ditampilkan. Muat ulang halaman; jika masih gagal,
        coba lagi beberapa saat lagi.
      </p>
      {requestId !== undefined && (
        <p className="text-sm text-muted-foreground">
          Kode permintaan: <code>{requestId}</code>
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button
          onClick={() => {
            window.location.reload();
          }}
        >
          Muat ulang halaman
        </Button>
        <Link href="/">Kembali ke katalog</Link>
      </p>
    </div>
  );
}
