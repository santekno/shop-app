import type { CategoryNode } from "@goshop/shared";

interface CategoryTreeProps {
  nodes: readonly CategoryNode[];
}

/** Nested lists of categories; a node with children renders another tree. */
export function CategoryTree({ nodes }: CategoryTreeProps) {
  return (
    <ul className="category-tree">
      {nodes.map((node) => (
        <li key={node.id}>
          <span className="category-name">{node.name}</span>
          {node.children.length > 0 && <CategoryTree nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}
