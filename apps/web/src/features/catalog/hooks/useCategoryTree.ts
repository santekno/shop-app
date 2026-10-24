import { useQuery } from "@tanstack/react-query";
import { buildCategoryTree } from "@goshop/shared";
import { categoriesQuery } from "../api/queries.ts";

/**
 * The categories as a tree, from the cached GET /v1/categories.
 *
 * Bab 8 wrote this hook by hand: an effect, an AbortController, a state
 * union and an `attempt` counter for retrying. useQuery does all of it,
 * and more: every component that calls this hook shares one request and
 * one cache entry, and the result survives leaving the page.
 *
 * `select` turns the cached list into what this hook's callers need; the
 * cache keeps the API's list, so another caller can select something
 * else from it. buildCategoryTree is a function defined once, so the
 * tree is rebuilt only when the data changes, not on every render.
 */
export const useCategoryTree = () =>
  useQuery({ ...categoriesQuery(), select: buildCategoryTree });
