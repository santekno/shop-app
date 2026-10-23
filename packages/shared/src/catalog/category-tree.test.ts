import { describe, expect, it } from "vitest";
import type { Category } from "../api/types.ts";
import { buildCategoryTree } from "./category-tree.ts";
import type { CategoryNode } from "./category-tree.ts";

const category = (id: string, parentId: string | null = null): Category => ({
  id,
  slug: `slug-${id}`,
  name: `Name ${id}`,
  parent_id: parentId,
});

/** The tree as nested [id, children] pairs, so a test reads the shape at a glance. */
type Shape = [string, Shape[]];
const shape = (nodes: readonly CategoryNode[]): Shape[] =>
  nodes.map((node) => [node.id, shape(node.children)]);

describe("buildCategoryTree", () => {
  it("returns no nodes for an empty list", () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it("nests children under their parent and keeps every field", () => {
    const tree = buildCategoryTree([category("1"), category("2", "1")]);

    expect(tree).toEqual([
      {
        id: "1",
        slug: "slug-1",
        name: "Name 1",
        parent_id: null,
        children: [
          {
            id: "2",
            slug: "slug-2",
            name: "Name 2",
            parent_id: "1",
            children: [],
          },
        ],
      },
    ]);
  });

  it("keeps the input order at every level", () => {
    const tree = buildCategoryTree([
      category("b"),
      category("a"),
      category("b2", "b"),
      category("a3", "a"),
      category("b1", "b"),
      category("a1", "a"),
      category("a3y", "a3"),
      category("a3x", "a3"),
    ]);

    expect(shape(tree)).toEqual([
      [
        "b",
        [
          ["b2", []],
          ["b1", []],
        ],
      ],
      [
        "a",
        [
          [
            "a3",
            [
              ["a3y", []],
              ["a3x", []],
            ],
          ],
          ["a1", []],
        ],
      ],
    ]);
  });

  it("finds a child that comes before its parent in the list", () => {
    expect(
      shape(buildCategoryTree([category("2", "1"), category("1")])),
    ).toEqual([["1", [["2", []]]]]);
  });

  it("makes a category whose parent is missing a top-level node", () => {
    const tree = buildCategoryTree([
      category("1"),
      category("orphan", "deleted"),
      category("child", "orphan"),
    ]);

    expect(shape(tree)).toEqual([
      ["1", []],
      ["orphan", [["child", []]]],
    ]);
  });

  it("cuts a parent loop instead of recursing forever", () => {
    // Only a duplicated id can lead from a root back into a loop: "1" is a
    // root, "2" is its child, and the second "1" claims "2" as its parent.
    const tree = buildCategoryTree([
      category("1"),
      category("2", "1"),
      { ...category("1", "2"), name: "Duplicate" },
    ]);

    expect(shape(tree)).toEqual([["1", [["2", []]]]]);
  });

  it("cuts a loop that returns to a node below the root", () => {
    // 1 → 2 → 3, then a second "2" under 3 points back into the path.
    const tree = buildCategoryTree([
      category("1"),
      category("2", "1"),
      category("3", "2"),
      { ...category("2", "3"), name: "Duplicate" },
    ]);

    expect(shape(tree)).toEqual([["1", [["2", [["3", []]]]]]]);
  });

  it("returns nothing for a cycle that has no root", () => {
    expect(buildCategoryTree([category("a", "b"), category("b", "a")])).toEqual(
      [],
    );
    expect(buildCategoryTree([category("self", "self")])).toEqual([]);
  });

  it("builds deep nesting", () => {
    const depth = 200;
    const chain = Array.from({ length: depth }, (_, i) =>
      category(String(i), i === 0 ? null : String(i - 1)),
    );

    let node = buildCategoryTree(chain)[0];
    let levels = 0;
    while (node !== undefined) {
      expect(node.id).toBe(String(levels));
      expect(node.children.length).toBeLessThanOrEqual(1);
      levels++;
      node = node.children[0];
    }
    expect(levels).toBe(depth);
  });

  it("does not mutate its input", () => {
    const input = [category("1"), category("2", "1"), category("3", "2")];
    const before = structuredClone(input);
    for (const item of input) Object.freeze(item);
    Object.freeze(input);

    const tree = buildCategoryTree(input);

    expect(input).toEqual(before);
    expect(input[0]).not.toHaveProperty("children");
    expect(tree[0]).not.toBe(input[0]);
  });
});
