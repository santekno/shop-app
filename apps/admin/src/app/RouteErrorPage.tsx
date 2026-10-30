import { Link, useRouteError } from "react-router";
import { Button } from "@/components/ui/Button.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useLateHeadingFocus } from "@/hooks/useLateHeadingFocus.ts";
import { errorRequestId } from "@/lib/error-message.ts";
import { CenteredPage } from "./CenteredPage.tsx";

/**
 * A page's error boundary (`ErrorBoundary` in routes.tsx): what renders
 * instead of a page that threw while rendering. Inside the dashboard
 * layout, so the sidebar and the header stay and any link leaves the
 * error behind (the router resets the boundary on the next navigation).
 *
 * Everything that reaches it is unexpected. The API's 403 never does
 * (artikel 08): no page throws a failed request (TanStack Query keeps it
 * in the query), so a 403 is told where it happened, in that page's own
 * words (ErrorState, the order panel's alert).
 */
export function RouteErrorPage() {
  const error = useRouteError();
  useDocumentTitle("Terjadi kesalahan — GoShop Admin");
  const requestId = errorRequestId(error);
  const headingRef = useLateHeadingFocus();

  return (
    <div className="grid justify-items-start gap-4" role="alert">
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
        <Link to="/">Kembali ke ringkasan</Link>
      </p>
    </div>
  );
}

/**
 * The root route's error boundary: an error outside the dashboard layout
 * (in the layout itself, the login page or the session check). There is
 * no <main> around it then, so it brings its own.
 */
export function RootErrorPage() {
  return (
    <CenteredPage>
      <RouteErrorPage />
    </CenteredPage>
  );
}
