// How the product page asks for a product: the slug goes into the path
// through encodeURIComponent, and the API's 404 NOT_FOUND becomes the 404
// page ("Halaman tidak ditemukan"). The seed's slugs need no encoding, so this test hands
// the catalog a product whose slug does, by rewriting one slug in the
// API's real first page; the product request itself goes to the real API.
import { expect, test } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import type { ProductRow } from "../support/catalog.ts";
import {
  FIRST_PAGE_QUERY,
  countApiRequests,
  expectNoProblems,
  openProduct,
  productCards,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** A slug with a space, a slash, a question mark, a hash and a non-ASCII letter. */
const AWKWARD_SLUG = "kopi susu/gula aren?ü#1";

test("a slug that needs encoding is encoded, and a 404 shows the not-found page", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  let renamed: ProductRow | undefined;

  // Only the first catalog page is rewritten; everything else is real.
  const firstPage = `${BROWSER_API_URL}/v1/products?${FIRST_PAGE_QUERY}`;
  await page.route(
    (url) => url.href === firstPage,
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { data: ProductRow[] };
      const first = body.data[0];
      if (first !== undefined) {
        first.slug = AWKWARD_SLUG;
        renamed = first;
      }
      await route.fulfill({ response, json: body });
    },
  );

  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();
  expect(renamed, "the first catalog page was rewritten").toBeDefined();
  await openProduct(page, renamed?.name ?? "");

  const encoded = encodeURIComponent(AWKWARD_SLUG);
  expect(encoded).toBe("kopi%20susu%2Fgula%20aren%3F%C3%BC%231");
  const heading = page.getByRole("heading", {
    level: 1,
    name: "Halaman tidak ditemukan",
  });
  await expect(heading).toBeVisible();
  await expect(
    page.getByText("Produk ini tidak ada atau sudah tidak dijual."),
  ).toBeVisible();
  await expect(page).toHaveTitle("Halaman tidak ditemukan — GoShop");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Kembali ke katalog" }),
  ).toHaveAttribute("href", "/");
  // One request, with the whole slug as one encoded path segment.
  expect(calls.get(`/v1/products/${encoded}`)).toEqual([
    `GET /v1/products/${encoded}`,
  ]);
  // NOT_FOUND is an answer, not a failure: no error box, nothing to retry.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Coba lagi" })).toHaveCount(0);
  // The 404 page's heading takes the focus over from <main>.
  await expect(heading).toBeFocused();

  // Chrome logs the 404 itself as a failed resource load; that is the
  // answer under test, and nothing else may appear: the expected
  // NOT_FOUND is not reported as a crash.
  const unexpected = problems.consoleErrors.filter(
    (text) =>
      !text.startsWith(
        "Failed to load resource: the server responded with a status of 404",
      ),
  );
  expect(problems.consoleErrors.length - unexpected.length).toBe(1);
  expectNoProblems({ ...problems, consoleErrors: unexpected });
});
