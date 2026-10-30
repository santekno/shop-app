import { useQuery } from "@tanstack/react-query";
import { buildCategoryTree } from "@goshop/shared";
import type { Category, CategoryNode } from "@goshop/shared";
import { categoriesQuery } from "../api/queries.ts";

/** A category as the filter menu lists it: its ID, name and depth. */
export interface CategoryOption {
  id: string;
  name: string;
  /** 0 for a top-level category, 1 for its child, and so on. */
  depth: number;
}

/** The tree, flattened depth-first: each parent followed by its children. */
const flatten = (nodes: CategoryNode[], depth = 0): CategoryOption[] =>
  nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flatten(node.children, depth + 1),
  ]);

/** GET /v1/categories as a list for a <select>: parents before children. */
export const toCategoryOptions = (categories: Category[]): CategoryOption[] =>
  flatten(buildCategoryTree(categories));

/**
 * The categories as options for the category filter, from the cached
 * GET /v1/categories. `select` reshapes the cached list for this caller
 * only; toCategoryOptions is defined once, so it runs again only when
 * the data changes.
 */
export const useCategoryOptions = () =>
  useQuery({ ...categoriesQuery(), select: toCategoryOptions });
