// The storefront as a buyer gets it: the web container's build, in a real
// browser, with the CSP the container sends. Since Bab 11 (artikel 09) the
// catalog's categories and first page come with the HTML, fetched by the
// server; the browser calls the real API across origins (localhost:5173 ->
// localhost:8080) for what is personal, such as the session.
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  PAGE_SIZE,
  asHtml,
  countApiRequests,
  disableAutoLoad,
  expectNoProblems,
  productCards,
  productSection,
} from "../support/catalog.ts";
import {
  BROWSER_API_URL,
  SEEDED_TREE,
  WEB_URL,
  fetchCategories,
  nestByParent,
} from "../support/stack.ts";
import type { NamedNode } from "../support/stack.ts";

/** Reads the rendered category tree back out of the DOM, by name. */
const readTree = (section: Locator): Promise<NamedNode[]> =>
  section.evaluate((element) => {
    const walk = (list: Element): NamedNode[] =>
      Array.from(list.children)
        .filter((item) => item.tagName === "LI")
        .map((item) => {
          const sublist = item.querySelector(":scope > ul");
          return {
            name:
              item.querySelector(":scope > .category-name")?.textContent ?? "",
            children: sublist ? walk(sublist) : [],
          };
        });
    // The first tree in document order is the top level; since Bab 10 it
    // sits inside the block the phone toggle folds (CategorySection).
    const top = element.querySelector("ul.category-tree");
    return top ? walk(top) : [];
  });

test("renders the seeded category tree from the API, in the server's HTML", async ({
  page,
  request,
}) => {
  const problems = await watchBrowser(page);
  const rows = await fetchCategories();
  const expected = nestByParent(rows);

  // In the HTML already, before any JavaScript runs.
  const html = await (await request.get("/")).text();
  for (const row of rows) expect(html, row.name).toContain(asHtml(row.name));

  const refreshResponse = page.waitForResponse(
    `${BROWSER_API_URL}/v1/auth/web/refresh`,
  );
  await page.goto("/");
  await expect(page).toHaveTitle("Katalog — GoShop");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");

  const section = page.getByRole("region", { name: "Kategori" });
  await expect(section.getByRole("list").first()).toBeVisible();
  await expect(section.getByRole("status")).toHaveCount(0);
  await expect(section.getByRole("alert")).toHaveCount(0);

  // Exactly what the API returned, nested by parent_id, in the API's order.
  const rendered = await readTree(section);
  expect(rendered).toEqual(expected);

  // And it is the seeded catalog (make test-integration runs make seed
  // first), so the tree really has parents with children in it.
  for (const [parent, children] of Object.entries(SEEDED_TREE)) {
    const node = rendered.find((n) => n.name === parent);
    expect(node, `seeded category ${parent} is rendered`).toBeDefined();
    expect(node?.children.map((c) => c.name)).toEqual(
      expect.arrayContaining([...children]),
    );
  }

  // The browser's own call (does it hold a session?) crossed origins, and
  // CORS let the page read it, with the credentials it needs.
  const response = await refreshResponse;
  expect(response.status()).toBe(204);
  expect(response.headers()["access-control-allow-credentials"]).toBe("true");
  expect(response.headers()["access-control-allow-origin"]).toBe(WEB_URL);
  expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f]{32}$/);

  expect(problems.consoleErrors).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
});

test("the browser asks the API once, for the session, and never retries", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);

  // No automatic loading: the sentinel could otherwise fetch page 2 as
  // soon as it is near the viewport.
  await disableAutoLoad(page);
  const refresh = page.waitForResponse(
    `${BROWSER_API_URL}/v1/auth/web/refresh`,
  );
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Kategori" }).getByRole("list").first(),
  ).toBeVisible();
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  expect((await refresh).status()).toBe(204);
  await expect(
    productSection(page).getByRole("button", { name: "Muat lebih banyak" }),
  ).toBeEnabled();

  // One request in all: the production build runs each effect once
  // (StrictMode doubles them in dev only) and a successful answer is never
  // retried. The categories and the first page came with the HTML (the
  // browser starts with the server's data, Bab 11 artikel 09), so the only
  // call left is the one every page load makes since Bab 10: does the
  // browser hold a session (204 for a visitor who is not logged in)?
  expect(Object.fromEntries(calls)).toEqual({
    "/v1/auth/web/refresh": ["POST /v1/auth/web/refresh"],
  });
  expectNoProblems(problems);
});
