import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";
import { ProductDetailPage } from "@/features/product/components/ProductDetailPage.tsx";
import { SiteHeader } from "./SiteHeader.tsx";

export function App() {
  // Which product is open, or null for the catalog. It lives here, in the
  // closest component above everything that needs it: the header (the
  // brand goes back to the catalog), the catalog (a card opens a product)
  // and the product page (its back button). They get the value and
  // callbacks as props: data flows down, changes flow up. Bab 9 replaces
  // this state with a URL and React Router.
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // The product the buyer comes back from, so its card can get the focus
  // again: a ref, not state, because changing it must not render anything.
  const returnFocusTo = useRef<string | null>(null);

  // useCallback returns the same function on every render (until a
  // dependency changes). Needed here because the function reaches every
  // ProductCard, which is memoised: a new function on each render would
  // count as a changed prop and re-render all the cards.
  const showProduct = useCallback((slug: string) => {
    setSelectedSlug(slug);
    // The product page starts at the top, not where the grid was scrolled.
    window.scrollTo({ top: 0 });
  }, []);

  // No useCallback: the header and the product page are not memoised, so
  // a new function costs nothing. Neither does useMemo pay for cheap work
  // such as the subtotal in ProductDetail; reach for both when a profile
  // (React DevTools) shows a render that is slow or happens for nothing.
  const showCatalog = () => {
    returnFocusTo.current = selectedSlug;
    setSelectedSlug(null);
  };

  // Runs after a render in which selectedSlug changed. Only the way back
  // does something: the catalog is visible again, so the card's button can
  // take the focus (and focus() scrolls it into view, near where the buyer
  // was). CSS.escape makes any slug safe inside the selector's quotes.
  useEffect(() => {
    if (selectedSlug !== null) return;
    const slug = returnFocusTo.current;
    if (slug === null) return;
    returnFocusTo.current = null;
    document
      .querySelector<HTMLElement>(`[data-product-slug="${CSS.escape(slug)}"]`)
      ?.focus();
  }, [selectedSlug]);

  // <>…</> is a fragment: it groups the header and main without adding a
  // wrapper element to the page.
  return (
    <>
      <SiteHeader onHome={showCatalog} />
      <main className="site-main">
        {/* hidden, not unmounted: the catalog keeps its state, so the pages
            the buyer already loaded are still there after "Kembali". */}
        <div hidden={selectedSlug !== null}>
          <CatalogPage onSelectProduct={showProduct} />
        </div>
        {selectedSlug !== null && (
          <ProductDetailPage slug={selectedSlug} onBack={showCatalog} />
        )}
      </main>
    </>
  );
}
