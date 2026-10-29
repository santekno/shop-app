// How the product page asks for a product: the slug goes into the API's
// path through encodeURIComponent, and the API's 404 NOT_FOUND becomes the
// not-found page ("Halaman tidak ditemukan"). Since Bab 11 (artikel 09)
// the storefront's server asks, not the browser: a direct load answers
// HTTP 404, and a navigation inside the app renders the same page. The
// seed's slugs need no encoding, so this test opens a slug that does; that
// the API saw it as one encoded path segment is read from the api
// container's request log (a "/" left unencoded would miss the route).
import { expect, test } from "@playwright/test";
import {
  clientNavigate,
  pageAlerts,
  watchBrowser,
} from "../support/browser.ts";
import { expectNoProblems, productCards } from "../support/catalog.ts";
import { compose } from "../support/stack.ts";

/** A slug with a space, a slash, a question mark, a hash and a non-ASCII letter. */
const AWKWARD_SLUG = "kopi susu/gula aren?ü#1";
const ENCODED = "kopi%20susu%2Fgula%20aren%3F%C3%BC%231";

/** The api container's request log lines for the awkward slug since since. */
const apiRequestsFor = (since: string): string[] =>
  compose("logs", "--no-color", "--since", since, "api")
    .split("\n")
    .filter(
      (line) =>
        line.includes('msg="http request"') &&
        (line.includes("kopi%20susu") || line.includes("kopi susu")),
    );

test("a slug that needs encoding is encoded, and a 404 shows the not-found page", async ({
  page,
}) => {
  expect(encodeURIComponent(AWKWARD_SLUG)).toBe(ENCODED);
  const since = new Date(Date.now() - 1000).toISOString();
  const problems = await watchBrowser(page);

  // Inside the app: Next.js' router asks the server for the page.
  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();
  await clientNavigate(page, `/produk/${ENCODED}`);
  const heading = page.getByRole("heading", {
    level: 1,
    name: "Halaman tidak ditemukan",
  });
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL(`/produk/${ENCODED}`);
  await expect(
    page.getByText("Produk ini tidak ada atau sudah tidak dijual."),
  ).toBeVisible();
  // The product route's own not-found page (app/produk/[slug]/not-found.tsx).
  await expect(page).toHaveTitle("Produk tidak ditemukan — GoShop");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Kembali ke katalog" }),
  ).toHaveAttribute("href", "/");
  // NOT_FOUND is an answer, not a failure: no error box, nothing to retry.
  await expect(pageAlerts(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Coba lagi" })).toHaveCount(0);
  // The 404 page's heading takes the focus over from <main>.
  await expect(heading).toBeFocused();

  // Loaded directly: the same page, with HTTP status 404 for a crawler.
  const response = await page.goto(`/produk/${ENCODED}`);
  expect(response?.status()).toBe(404);
  await expect(heading).toBeVisible();

  // Every request the storefront's server made for the slug reached the
  // product route as one path segment, and got the API's 404.
  await expect.poll(() => apiRequestsFor(since).length).toBeGreaterThan(0);
  for (const line of apiRequestsFor(since)) {
    expect(line).toContain("route=/v1/products/{slug}");
    expect(line).toContain("status=404");
  }

  // Chrome logs the 404s themselves (the router's request for the page,
  // the direct load) as failed resource loads; they are the answer under
  // test, and nothing else may appear.
  const unexpected = problems.consoleErrors.filter(
    (text) =>
      !text.startsWith(
        "Failed to load resource: the server responded with a status of 404",
      ),
  );
  expectNoProblems({ ...problems, consoleErrors: unexpected });
});
