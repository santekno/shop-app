import type { Category } from "../api/types.ts";

/** A category with its sub-categories, for rendering a nested menu. */
export interface CategoryNode extends Category {
  children: CategoryNode[];
}

/**
 * Turns the flat list from GET /v1/categories into a tree.
 *
 * The API sends every category once, parents before children, each with a
 * `parent_id`. The tree keeps that order at every level. A category whose
 * parent is not in the list becomes a top-level node instead of vanishing.
 *
 * Parent loops, which the API never sends, cannot hang it either:
 * - a loop with no top-level category in it (A's parent is B, B's parent
 *   is A) has no root to start from, so its categories are left out;
 * - a loop can only be reached from a root when an id appears twice in the
 *   list; the walk then stops at the first category it has already passed
 *   on its way down, instead of recursing forever.
 *
 * @example
 *   buildCategoryTree([
 *     { id: "1", slug: "pakaian", name: "Pakaian", parent_id: null },
 *     { id: "2", slug: "kaos", name: "Kaos", parent_id: "1" },
 *   ]);
 *   // [{ id: "1", …, children: [{ id: "2", …, children: [] }] }]
 */
export const buildCategoryTree = (
  categories: readonly Category[],
): CategoryNode[] => {
  // reduce folds the list into one value, here a Map from a parent id to its
  // children, in a single pass. In Go this is a for loop appending to
  // map[string][]Category.
  const childrenOf = categories.reduce((groups, category) => {
    if (category.parent_id !== null) {
      const siblings = groups.get(category.parent_id) ?? [];
      siblings.push(category);
      groups.set(category.parent_id, siblings);
    }
    return groups;
  }, new Map<string, Category[]>());

  // map transforms every element; a Set answers "is this id present?".
  const ids = new Set(categories.map((category) => category.id));

  // `ancestors` holds the ids on the path from the root to this node, so a
  // child that is also an ancestor (a loop) is skipped.
  const toNode = (
    category: Category,
    ancestors: ReadonlySet<string>,
  ): CategoryNode => ({
    ...category,
    children: (childrenOf.get(category.id) ?? [])
      .filter((child) => !ancestors.has(child.id))
      .map((child) => toNode(child, new Set([...ancestors, child.id]))),
  });

  // filter keeps the elements for which the function returns true.
  return categories
    .filter(
      (category) =>
        category.parent_id === null || !ids.has(category.parent_id),
    )
    .map((root) => toNode(root, new Set([root.id])));
};
