// The public API of @goshop/shared. Apps import from "@goshop/shared" only,
// never from a file inside src/, so files can move without breaking them;
// this file is the package's exported surface, like the capitalised names of
// a Go package.
//
// Named exports only (no `export default`): the name is the same in every
// file that imports it, and an editor can rename it everywhere. `export type`
// marks names that exist only for the type checker; they vanish from the
// JavaScript that runs.

export { createUrlBuilder, toQueryString } from "./api/url.ts";
export type { QueryParams, QueryValue } from "./api/url.ts";

export { buildCategoryTree } from "./catalog/category-tree.ts";
export type { Category, CategoryNode } from "./catalog/category-tree.ts";
