import type { Metadata } from "next";
import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";

// `absolute`: the root layout's title template applies to the pages below
// it, not to the page in its own folder, so this one is written out.
export const metadata: Metadata = { title: { absolute: "Katalog — GoShop" } };

/** "/": the catalog. */
export default function Home() {
  return <CatalogPage />;
}
