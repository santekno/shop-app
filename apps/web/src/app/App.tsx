import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";
import { SiteHeader } from "./SiteHeader.tsx";

export function App() {
  // <>…</> is a fragment: it groups the header and main without adding a
  // wrapper element to the page.
  return (
    <>
      <SiteHeader />
      <main className="site-main">
        <CatalogPage />
      </main>
    </>
  );
}
