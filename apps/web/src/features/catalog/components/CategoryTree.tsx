import { Link } from "react-router";
import type { CategoryNode } from "@goshop/shared";

interface CategoryTreeProps {
  nodes: readonly CategoryNode[];
  /** The slug of the category the catalog is filtered by, if any. */
  activeSlug: string | undefined;
  /** The catalog URL that filters by a category. */
  hrefFor: (slug: string) => string;
  /** Set for a sub-tree, which is indented under its parent. */
  nested?: boolean;
}

/** The look of a category link; aria-current marks the active filter. */
export const categoryLinkClasses =
  "no-underline hover:underline aria-[current=true]:font-bold aria-[current=true]:underline";

/**
 * Nested lists of categories; a node with children renders another tree.
 * Each name is a link that puts its category in the URL (?kategori=…),
 * so a filtered catalog can be bookmarked, shared and reached with Back.
 */
export function CategoryTree({
  nodes,
  activeSlug,
  hrefFor,
  nested = false,
}: CategoryTreeProps) {
  return (
    <ul className={nested ? "category-tree mt-1 pl-4" : "category-tree"}>
      {nodes.map((node) => (
        <li key={node.id} className="my-1">
          <Link
            to={hrefFor(node.slug)}
            className={`category-name ${categoryLinkClasses}`}
            // "true", not "page": the link marks the current item of a
            // set of filters, while the page itself stays the catalog.
            aria-current={node.slug === activeSlug ? "true" : undefined}
          >
            {node.name}
          </Link>
          {node.children.length > 0 && (
            <CategoryTree
              nodes={node.children}
              activeSlug={activeSlug}
              hrefFor={hrefFor}
              nested
            />
          )}
        </li>
      ))}
    </ul>
  );
}
