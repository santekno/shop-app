import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { isApiError } from "@goshop/shared";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useLateHeadingFocus } from "@/hooks/useLateHeadingFocus.ts";
import { errorRequestId } from "@/lib/error-message.ts";
import { NotFoundPage } from "./NotFoundPage.tsx";

/**
 * The routes' error boundary (`ErrorBoundary` in routes.tsx): what renders
 * instead of a route whose component threw while rendering, or whose lazy
 * code could not be loaded. useRouteError returns what was thrown.
 *
 * - An ApiError NOT_FOUND is a product that does not exist: the product
 *   page throws it on purpose (useQuery's throwOnError), so this shows the
 *   404 page, the same one as for an unknown URL.
 * - Anything else is a bug or a failed download, not something the buyer
 *   did. The page offers a reload: after a new deploy, the old page asks
 *   for code files that no longer exist, and a reload fetches the new ones.
 *
 * The router resets the boundary on the next navigation, so any link or
 * Back leaves the error behind.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  if (
    isApiError(error, "NOT_FOUND") ||
    (isRouteErrorResponse(error) && error.status === 404)
  ) {
    return (
      <NotFoundPage message="Produk ini tidak ada atau sudah tidak dijual." />
    );
  }
  return <UnexpectedError error={error} />;
}

function UnexpectedError({ error }: { error: unknown }) {
  useDocumentTitle("Terjadi kesalahan — GoShop");
  const requestId = errorRequestId(error);
  const headingRef = useLateHeadingFocus();
  return (
    <div className="grid gap-4" role="alert">
      <h1 ref={headingRef} tabIndex={-1}>
        Terjadi kesalahan
      </h1>
      <p>
        Halaman ini gagal ditampilkan. Muat ulang halaman; jika masih gagal,
        coba lagi beberapa saat lagi.
      </p>
      {requestId !== undefined && (
        <p className="muted">
          Kode permintaan: <code>{requestId}</code>
        </p>
      )}
      <p className="actions">
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          Muat ulang halaman
        </button>
        <Link to="/">Kembali ke katalog</Link>
      </p>
    </div>
  );
}
