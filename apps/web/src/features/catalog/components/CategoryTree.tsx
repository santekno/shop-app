import { Link } from "react-router";
import type { CategoryNode } from "@goshop/shared";

interface CategoryTreeProps {
  nodes: readonly CategoryNode[];
  /** The slug of the category the catalog is filtered by, if any. */
  activeSlug: string | undefined;
  /** The catalog URL that filters by a category. */
  hrefFor: (slug: string) => string;
}

/**
 * Nested lists of categories; a node with children renders another tree.
 * Each name is a link that puts its category in the URL (?kategori=…),
 * so a filtered catalog can be bookmarked, shared and reached with Back.
 */
export function CategoryTree({
  nodes,
  activeSlug,
  hrefFor,
}: CategoryTreeProps) {
  return (
    <ul className="category-tree">
      {nodes.map((node) => (
        <li key={node.id}>
          <Link
            to={hrefFor(node.slug)}
            className="category-name"
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
            />
          )}
        </li>
      ))}
    </ul>
  );
}
