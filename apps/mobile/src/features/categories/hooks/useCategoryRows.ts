// The category tree as the rows of one list. A FlatList takes a flat
// array; the tree's shape survives as each row's depth, which the row
// turns into indentation.
import { useQuery } from "@tanstack/react-query";
import { buildCategoryTree } from "@goshop/shared";
import type { Category, CategoryNode } from "@goshop/shared";
import { categoriesQuery } from "@/features/catalog/api/queries";

/** One category in the list, with how deep it sits in the tree (0 = top). */
export interface CategoryRow {
  node: CategoryNode;
  depth: number;
}

/**
 * Walks the tree depth first: a parent, then its children, then the next
 * parent. The order inside each level is the API's (sorted by name).
 */
export const flattenCategoryTree = (
  nodes: readonly CategoryNode[],
  depth = 0,
): CategoryRow[] =>
  nodes.flatMap((node) => [
    { node, depth },
    ...flattenCategoryTree(node.children, depth + 1),
  ]);

/**
 * buildCategoryTree comes from @goshop/shared, the function the web's
 * category menu uses: it keeps the API's order, puts a category whose
 * parent is missing at the top level, and cannot hang on a parent loop.
 */
const toCategoryRows = (categories: Category[]): CategoryRow[] =>
  flattenCategoryTree(buildCategoryTree(categories));

/**
 * The categories as list rows, from the cached GET /v1/categories. The
 * query is the catalog's categoriesQuery, the one Beranda reads for its
 * category chip: one definition, one cache entry.
 *
 * `select` reshapes what the screen gets while the cache keeps the API's
 * list, so the web-shaped key ["categories"] holds the same data on every
 * screen that asks for it. toCategoryRows is defined once, outside the
 * hook, so the rows are rebuilt only when the data changes, not on every
 * render.
 */
export const useCategoryRows = () =>
  useQuery({ ...categoriesQuery(), select: toCategoryRows });
