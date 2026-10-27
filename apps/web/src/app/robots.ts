import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/server-config.ts";

// Per request: SITE_URL is read when the server runs, not at build time.
export const dynamic = "force-dynamic";

/**
 * /robots.txt (Bab 11 artikel 11): which URLs crawlers may visit, and
 * where the sitemap is. It controls crawling, not indexing: keeping a page
 * out of search results is `noindex` (artikel 10), which a crawler only
 * sees on a page it is allowed to fetch.
 *
 * - **Allowed:** everything else, the catalog, its categories and the
 *   product pages first of all.
 * - **Disallowed, private:** the cart, checkout, payment, orders, account,
 *   login and register pages. They are personal, render only in the
 *   browser ("Memuat GoShop…" is all a crawler would get) and carry
 *   `noindex` anyway; not crawling them saves the crawl for the products.
 * - **Disallowed, search results:** `?q=` (the catalog writes `q` after
 *   `kategori`, so as `?q=` or `&q=`). Every word anyone types is a new
 *   URL, an endless space of thin pages; Google's guidelines ask sites to
 *   keep internal search out of the crawl with robots.txt. Their `noindex`
 *   (artikel 10) remains as the second line if one is crawled anyway.
 * - **Not disallowed:** sorted lists and unknown categories. A sorted list
 *   must be crawled for its canonical link to the unsorted one to be read;
 *   an unknown category must be crawled for its `noindex` to be seen.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/keranjang",
        "/checkout",
        "/pembayaran",
        "/pesanan",
        "/akun",
        "/masuk",
        "/daftar",
        "/*?q=",
        "/*&q=",
      ],
    },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}
