// /sitemap.xml and /robots.txt from the storefront container (Bab 11
// artikel 11): the sitemap lists exactly what artikel 10 lets search
// engines index (the catalog root, each category, every active product,
// with each product's lastmod the API's updated_at), on SITE_URL; and
// robots.txt keeps private pages and searches out of the crawl.
import { expect, test } from "@playwright/test";
import { fetchAllProducts } from "../support/catalog.ts";
import { headOf, normalUrl, siteUrl } from "../support/seo.ts";
import { SITE_URL, fetchCategories } from "../support/stack.ts";

/** One <url> of the sitemap. */
interface SitemapEntry {
  loc: string;
  lastmod: string | undefined;
}

const sitemapEntries = (xml: string): SitemapEntry[] =>
  [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const body = m[1] ?? "";
    return {
      loc: /<loc>([^<]*)<\/loc>/.exec(body)?.[1] ?? "",
      lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(body)?.[1],
    };
  });

test("the sitemap lists the root, every category and every product, each product with lastmod = the API's updated_at", async ({
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/xml/);
  const entries = sitemapEntries(await response.text());

  const locs = entries.map((entry) => entry.loc);
  expect(new Set(locs).size, "no URL twice").toBe(locs.length);
  for (const loc of locs) expect(loc.startsWith(`${SITE_URL}/`)).toBe(true);

  // The catalog: the root and each category's canonical list, no lastmod.
  const categories = await fetchCategories();
  const catalog = [
    siteUrl("/"),
    ...categories.map((category) => siteUrl(`/?kategori=${category.slug}`)),
  ];
  const catalogEntries = entries.filter(
    (entry) => !new URL(entry.loc).pathname.startsWith("/produk/"),
  );
  expect(catalogEntries.map((entry) => entry.loc).sort()).toEqual(
    [...catalog].sort(),
  );
  for (const entry of catalogEntries) expect(entry.lastmod).toBeUndefined();

  // Every active product the API lists, and nothing else, with the date
  // an admin last saved it (never created_at).
  const products = (await fetchAllProducts()).flat();
  const productEntries = entries.filter((entry) =>
    new URL(entry.loc).pathname.startsWith("/produk/"),
  );
  expect(
    Object.fromEntries(productEntries.map((e) => [e.loc, e.lastmod])),
  ).toEqual(
    Object.fromEntries(
      products.map((p) => [siteUrl(`/produk/${p.slug}`), p.updated_at]),
    ),
  );
});

test("every URL in the sitemap answers 200, is indexable and is its own canonical", async ({
  request,
}) => {
  test.setTimeout(60_000);
  const entries = sitemapEntries(
    await (await request.get("/sitemap.xml")).text(),
  );
  expect(entries.length).toBeGreaterThan(0);
  for (const { loc } of entries) {
    const url = new URL(loc);
    const head = await headOf(request, `${url.pathname}${url.search}`);
    expect(head.status, loc).toBe(200);
    expect(head.robots, loc).toBeUndefined();
    expect(normalUrl(head.canonical ?? ""), loc).toBe(loc);
  }
});

test("robots.txt keeps private pages and searches out of the crawl and names the sitemap on SITE_URL", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  expect(await response.text()).toBe(
    [
      "User-Agent: *",
      "Allow: /",
      "Disallow: /keranjang",
      "Disallow: /checkout",
      "Disallow: /pembayaran",
      "Disallow: /pesanan",
      "Disallow: /akun",
      "Disallow: /masuk",
      "Disallow: /daftar",
      "Disallow: /*?q=",
      "Disallow: /*&q=",
      "",
      `Sitemap: ${SITE_URL}/sitemap.xml`,
      "",
    ].join("\n"),
  );
});
