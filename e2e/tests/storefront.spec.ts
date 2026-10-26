// The storefront as a buyer gets it: the web container's build, in a real
// browser, calling the real API across origins (localhost:5173 ->
// localhost:8080), with the CSP the container sends.
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
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
    const top = element.querySelector(":scope > ul.category-tree");
    return top ? walk(top) : [];
  });

test("renders the seeded category tree from the API", async ({ page }) => {
  const problems = await watchBrowser(page);
  const rows = await fetchCategories();
  const expected = nestByParent(rows);

  const categoriesResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/v1/categories",
  );
  await page.goto("/");
  await expect(page).toHaveTitle("GoShop");
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

  // The browser call crossed origins and CORS let the page read it.
  const response = await categoriesResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()["access-control-allow-origin"]).toBe(WEB_URL);
  expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f]{32}$/);

  expect(problems.consoleErrors).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
});

test("loads the categories with one request and no retries", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/categories") {
      calls.push(request.method());
    }
  });

  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Kategori" }).getByRole("list").first(),
  ).toBeVisible();

  // One GET: the production build runs the effect once (StrictMode doubles
  // it in dev only), and a successful answer is never retried.
  expect(calls).toEqual(["GET"]);
  expect(problems.consoleErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
});
