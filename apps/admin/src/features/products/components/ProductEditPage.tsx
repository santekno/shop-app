import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { isApiError } from "@goshop/shared";
import { MAIN_ID } from "@/app/useRouteFocus.ts";
import { PageHeader } from "@/components/PageHeader.tsx";
import { Button } from "@/components/ui/Button.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useAdminProduct } from "../hooks/useAdminProduct.ts";
import { useUpdateProduct } from "../hooks/useProductMutations.ts";
import { productToFormValues } from "../product-form.ts";
import { ArchiveProductButton } from "./ArchiveProductButton.tsx";
import { ProductForm } from "./ProductForm.tsx";
import { ProductPhotosSection } from "./ProductPhotosSection.tsx";
import { ProductStatusBadge } from "./ProductStatusBadge.tsx";
import { StockPanel } from "./StockPanel.tsx";

/** What another page may hand this one in the history entry's state. */
export interface ProductPageState {
  /** A sentence to announce on arrival ("Produk … tersimpan."). */
  notice?: string;
}

const noticeIn = (state: unknown): string | undefined =>
  typeof state === "object" &&
  state !== null &&
  "notice" in state &&
  typeof state.notice === "string"
    ? state.notice
    : undefined;

/** The page's <h1>, after its content changed under the focus. */
const focusPageHeading = () => {
  document
    .getElementById(MAIN_ID)
    ?.querySelector<HTMLElement>("h1")
    ?.focus({ preventScroll: true });
};

/**
 * /produk/:productId: one product, loaded with GET /v1/admin/products/{id}
 * into the same three-step form, saved with PUT.
 *
 * The form starts from the product the query has, and keeps the
 * product's and each variant's `version` from it, which is what makes a
 * stale save fail with 409 instead of overwriting stock a buyer just
 * took. A form with no changes follows the query (`latest`, artikel 05),
 * so a quick stock change above it, or a background refetch after another
 * admin's save, does not make its next save fail. A form with changes
 * belongs to the seller: a refetch never overwrites what is being typed.
 * After a 409 the form fetches the product again (`loadLatest`) and shows
 * what changed next to the seller's changes. Archiving starts the form over from the product as
 * the server has it now, by changing its `key` (React mounts a new one).
 * A save does not need it: the form resets itself to the saved product,
 * new versions included.
 *
 * "Stok" (StockPanel, artikel 05) sits above the form: the server's stock
 * per variant, with a quick change that does not go through the form.
 *
 * The photos are their own section under the form (artikel 04), not a
 * step of it: a photo belongs to a product that exists, and each photo is
 * saved on its own the moment it is uploaded, while the form waits for
 * "Simpan". The section reads the same product query, so a refetch while
 * a photo is processing updates the photos and leaves the form alone. Its
 * `key` is the product: another product's page starts with no uploads.
 */
export function ProductEditPage() {
  const { productId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useAdminProduct(productId);
  const update = useUpdateProduct(productId);
  const product = query.data;
  const [notice, setNotice] = useState(() => noticeIn(location.state));
  const [formKey, setFormKey] = useState(0);
  useDocumentTitle(
    `${product === undefined ? "Ubah produk" : product.name} — GoShop Admin`,
  );

  // The notice from the create page is shown once: forget it in the
  // history entry, or a reload would announce "tersimpan" again.
  useEffect(() => {
    if (noticeIn(location.state) === undefined) return;
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  // After the form started over, the button that did it is gone; the
  // focus goes to the page's heading instead of falling to <body>.
  useEffect(() => {
    if (formKey > 0) focusPageHeading();
  }, [formKey]);

  /** The product as the server has it now, for the conflict review. */
  const loadLatest = async () => {
    const result = await query.refetch();
    if (result.isError) throw result.error;
    if (result.data === undefined) throw new Error("product not loaded");
    return result.data;
  };

  return (
    <>
      <PageHeader
        title="Ubah produk"
        description={
          product === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-all">{product.name}</span>
              <ProductStatusBadge status={product.status} />
            </span>
          )
        }
        actions={
          product === undefined || product.status === "archived" ? undefined : (
            <ArchiveProductButton
              product={product}
              onArchived={() => {
                setNotice(
                  "Produk diarsipkan dan tidak tampil lagi di toko. Simpan dengan status Aktif atau Draf untuk memulihkannya.",
                );
                setFormKey((key) => key + 1);
              }}
            />
          )
        }
      />

      {/* role="status": announced politely, without taking the focus. */}
      <p role="status" className="mb-4 empty:hidden">
        {notice}
      </p>

      {query.isPending && <LoadingState>Memuat produk…</LoadingState>}

      {query.isError &&
        product === undefined &&
        (isApiError(query.error, "NOT_FOUND") ? (
          <div className="grid justify-items-start gap-2">
            <EmptyState>
              Produk ini tidak ditemukan. Mungkin alamatnya salah ketik.
            </EmptyState>
            <Button asChild variant="outline" size="sm">
              <Link to="/produk">Kembali ke daftar produk</Link>
            </Button>
          </div>
        ) : (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ))}

      {product !== undefined && <StockPanel product={product} />}

      {product !== undefined && (
        <ProductForm
          key={`${product.id}:${formKey}`}
          mode="edit"
          defaultValues={productToFormValues(product)}
          cancelTo="/produk"
          onSave={(body) => update.mutateAsync(body)}
          onSaved={(saved) => {
            setNotice(`Perubahan pada “${saved.name}” tersimpan.`);
          }}
          loadLatest={loadLatest}
          latest={product}
        />
      )}

      {product !== undefined && (
        <ProductPhotosSection
          key={product.id}
          product={product}
          dataUpdatedAt={query.dataUpdatedAt}
        />
      )}
    </>
  );
}
