// Metadata and structured data from the storefront container (Bab 11
// artikel 10), read from the server's HTML as a crawler reads it: each
// page's <title>, canonical link and robots meta per the catalog's rule
// (features/catalog/catalog-metadata.ts: a category is indexed, a sort
// points at the unsorted list, a search and an unknown category are
// noindex), Open Graph on SITE_URL, and the product's JSON-LD against the
// API's product.
import { expect, test } from "@playwright/test";
import { fetchProduct } from "../support/catalog.ts";
import {
  expectedProductJsonLd,
  headOf,
  jsonLdBlock,
  normalUrl,
  siteUrl,
} from "../support/seo.ts";

/** One catalog URL and what its head must say. */
interface CatalogCase {
  path: string;
  title: string;
  /** The canonical path, or undefined for none. */
  canonical: string | undefined;
  /** noindex (with follow) or indexed. */
  noindex: boolean;
}

const CATALOG_CASES: readonly CatalogCase[] = [
  { path: "/", title: "Katalog — GoShop", canonical: "/", noindex: false },
  {
    path: "/?kategori=kaos",
    title: "Kaos — GoShop",
    canonical: "/?kategori=kaos",
    noindex: false,
  },
  // A sort shows the same products: canonical to the unsorted list, and
  // not noindex as well (the two would contradict each other).
  {
    path: "/?kategori=kaos&urut=termurah",
    title: "Kaos — GoShop",
    canonical: "/?kategori=kaos",
    noindex: false,
  },
  // What readCatalogFilters ignores is dropped from the canonical URL.
  {
    path: "/?urut=xyz&utm_source=wa",
    title: "Katalog — GoShop",
    canonical: "/",
    noindex: false,
  },
  {
    path: "/?q=kaos",
    title: "Hasil pencarian “kaos” — GoShop",
    canonical: undefined,
    noindex: true,
  },
  {
    path: "/?kategori=kaos&q=polos",
    title: "Hasil pencarian “polos” — GoShop",
    canonical: undefined,
    noindex: true,
  },
  {
    path: "/?kategori=tidak-ada",
    title: "Kategori tidak ditemukan — GoShop",
    canonical: undefined,
    noindex: true,
  },
];

for (const c of CATALOG_CASES) {
  test(`catalog ${c.path}: "${c.title}", ${c.canonical === undefined ? "no canonical" : `canonical ${c.canonical}`}, ${c.noindex ? "noindex" : "indexed"}`, async ({
    request,
  }) => {
    const head = await headOf(request, c.path);
    expect(head.status).toBe(200);
    expect(head.title).toBe(c.title);
    if (c.canonical === undefined) {
      expect(head.canonical).toBeUndefined();
      expect(head.meta["og:url"]).toBeUndefined();
      expect(head.robots).toBe("noindex, follow");
    } else {
      expect(normalUrl(head.canonical ?? "")).toBe(siteUrl(c.canonical));
      expect(normalUrl(head.meta["og:url"] ?? "")).toBe(siteUrl(c.canonical));
      // Indexed: no robots meta at all (index, follow is the default).
      expect(head.robots).toBeUndefined();
    }
  });
}

test("a category page's description names the category", async ({
  request,
}) => {
  const head = await headOf(request, "/?kategori=kaos");
  expect(head.meta.description).toBe(
    "Belanja Kaos di GoShop: harga, varian, dan stok terbaru.",
  );
  expect(head.meta["og:title"]).toBe("Kaos — GoShop");
});

test("a product page: its name as the title, its description, a canonical link without tracking parameters, and Open Graph on SITE_URL", async ({
  request,
}) => {
  const product = await fetchProduct("kaos-polos-hitam");
  const head = await headOf(request, `/produk/${product.slug}?utm_source=wa`);
  expect(head.status).toBe(200);
  const url = siteUrl(`/produk/${product.slug}`);
  expect(head.title).toBe(`${product.name} — GoShop`);
  expect(head.canonical).toBe(url);
  expect(head.robots).toBeUndefined();
  expect(head.meta.description).toBe(product.description);
  expect(head.meta["og:title"]).toBe(`${product.name} — GoShop`);
  expect(head.meta["og:description"]).toBe(product.description);
  expect(head.meta["og:url"]).toBe(url);
  expect(head.meta["og:site_name"]).toBe("GoShop");
  expect(head.meta["og:locale"]).toBe("id_ID");
  // No photo: a small card and no og:image (artikel 12 adds them).
  expect(product.images).toEqual([]);
  expect(head.meta["twitter:card"]).toBe("summary");
  expect(head.meta["og:image"]).toBeUndefined();
});

test("a product that does not exist answers 404 with noindex", async ({
  request,
}) => {
  const head = await headOf(request, "/produk/tidak-ada");
  expect(head.status).toBe(404);
  expect(head.title).toBe("Produk tidak ditemukan — GoShop");
  expect(head.robots).toBe("noindex");
  expect(head.canonical).toBeUndefined();
  expect(head.html).not.toContain("application/ld+json");
});

// The cart and the auth forms are noindex; the account pages (checkout,
// orders, payment: app/(akun)/layout.tsx) are noindex, nofollow too.
const PRIVATE_PAGES: Readonly<Record<string, string>> = {
  "/keranjang": "noindex",
  "/masuk": "noindex",
  "/daftar": "noindex",
  "/checkout": "noindex, nofollow",
  "/pesanan": "noindex, nofollow",
  "/pembayaran/selesai": "noindex, nofollow",
};

for (const [path, robots] of Object.entries(PRIVATE_PAGES)) {
  test(`the private page ${path} is ${robots}, with no canonical link`, async ({
    request,
  }) => {
    const head = await headOf(request, path);
    expect(head.status).toBe(200);
    expect(head.robots).toBe(robots);
    expect(head.canonical).toBeUndefined();
  });
}

for (const slug of ["kaos-polos-hitam", "kacang-mete-panggang-250g"]) {
  test(`the JSON-LD of ${slug} states the API's product, prices and stock, and its breadcrumb`, async ({
    request,
  }) => {
    const product = await fetchProduct(slug);
    const head = await headOf(request, `/produk/${slug}`);
    expect(head.status).toBe(200);
    const productLd = jsonLdBlock(head.html, "Product");
    expect(productLd).toEqual(expectedProductJsonLd(product));
    // Says only what the page shows: GoShop has no brands and no ratings.
    expect(productLd).not.toHaveProperty("brand");
    expect(productLd).not.toHaveProperty("aggregateRating");
    expect(productLd).not.toHaveProperty("review");

    expect(jsonLdBlock(head.html, "BreadcrumbList")).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Katalog",
          item: siteUrl("/"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: product.category.name,
          item: siteUrl(`/?kategori=${product.category.slug}`),
        },
        {
          "@type": "ListItem",
          position: 3,
          name: product.name,
          item: siteUrl(`/produk/${product.slug}`),
        },
      ],
    });
    // A block is data, never closed early: as many </script> as <script.
    expect(head.html.match(/<script\b/g)?.length).toBe(
      head.html.match(/<\/script>/g)?.length,
    );
  });
}
