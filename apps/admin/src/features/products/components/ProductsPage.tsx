import { Plus } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/PageHeader.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Skeleton } from "@/components/ui/Skeleton.tsx";
import { EmptyState, ErrorState } from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useProductTable } from "../hooks/useProductTable.ts";
import { useProductTableParams } from "../hooks/useProductTableParams.ts";
import { CLEAR_FILTERS, hasActiveFilters } from "../product-table-params.ts";
import { ProductFilters } from "./ProductFilters.tsx";
import { ProductTable } from "./ProductTable.tsx";

/**
 * /produk: every product of the shop, in any status, as a data table
 * that searches, filters, sorts and pages on the server.
 *
 * The page connects three things: the URL (useProductTableParams, the
 * table's state), the API (useProductTable, one page for that state) and
 * the table (ProductTable, which renders the page and turns clicks into
 * URL changes). A click changes the URL; the URL changes the query key;
 * the new key fetches the new page.
 */
export function ProductsPage() {
  useDocumentTitle("Produk — GoShop Admin");
  const { params, update } = useProductTableParams();
  const query = useProductTable(params);
  const { data } = query;
  const filtered = hasActiveFilters(params);

  return (
    <>
      <PageHeader
        title="Produk"
        description="Semua produk toko, termasuk draf dan yang diarsipkan."
        actions={
          <Button asChild>
            <Link to="/produk/baru">
              <Plus aria-hidden="true" />
              Tambah produk
            </Link>
          </Button>
        }
      />
      <ProductFilters params={params} onChange={update} />

      {query.isPending && <ProductTableSkeleton rows={5} />}

      {query.isError && (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}

      {data !== undefined &&
        (data.page.total === 0 ? (
          <div className="grid justify-items-start gap-2">
            <EmptyState>
              {filtered
                ? "Tidak ada produk yang cocok dengan pencarian atau filter ini."
                : "Belum ada produk. Produk yang ditambahkan akan muncul di sini."}
            </EmptyState>
            {filtered && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  update(CLEAR_FILTERS);
                }}
              >
                Hapus filter
              </Button>
            )}
          </div>
        ) : data.data.length === 0 ? (
          // A page past the last one (a stale link, or products deleted
          // since): the API answers an empty page with the real total.
          <div className="grid justify-items-start gap-2">
            <EmptyState>
              Halaman {params.page} tidak ada: hasilnya hanya{" "}
              {data.page.total_pages} halaman.
            </EmptyState>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                update({ page: data.page.total_pages });
              }}
            >
              Ke halaman {data.page.total_pages}
            </Button>
          </div>
        ) : (
          <ProductTable
            result={data}
            params={params}
            onChange={update}
            busy={query.isPlaceholderData}
          />
        ))}
    </>
  );
}

/**
 * The first load, before there is any page to keep on screen: grey rows
 * in the table's shape, and "Memuat produk…" for a screen reader.
 */
function ProductTableSkeleton({ rows }: { rows: number }) {
  return (
    <div
      role="status"
      className="grid gap-3 rounded-lg border border-border bg-card p-3"
    >
      <span className="sr-only">Memuat produk…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="hidden h-4 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}
