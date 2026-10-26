// listCategories from @goshop/shared against the real API, from Node: the
// unit tests fake fetch, so only this proves that the types generated from
// api/openapi.yaml match what the running API actually sends.
import { expect, test } from "@playwright/test";
import { listCategories } from "@goshop/shared";
import { api, apiErrorOf } from "../support/api.ts";
import { SEEDED_TREE, fetchCategories } from "../support/stack.ts";

test.describe("listCategories against the real API", () => {
  test("returns the data array of GET /v1/categories, as the contract types it", async () => {
    const categories = await listCategories(api);
    expect(categories).toEqual(await fetchCategories());

    const ids = new Set(categories.map((c) => c.id));
    for (const category of categories) {
      // Exactly the four fields of the Category schema (additionalProperties: false).
      expect(Object.keys(category).sort()).toEqual([
        "id",
        "name",
        "parent_id",
        "slug",
      ]);
      expect(category.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(category.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      // parent_id is null or names a category in the same list.
      if (category.parent_id !== null) {
        expect(ids.has(category.parent_id)).toBe(true);
      }
    }

    const names = categories.map((c) => c.name);
    for (const [parent, children] of Object.entries(SEEDED_TREE)) {
      expect(names).toEqual(expect.arrayContaining([parent, ...children]));
    }
  });

  test("an aborted signal rejects with ABORTED before anything is sent", async () => {
    const error = await apiErrorOf(() =>
      listCategories(api, { signal: AbortSignal.abort() }),
    );
    expect(error.code).toBe("ABORTED");
    expect(error.status).toBe(0);
  });
});
