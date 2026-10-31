// API objects for the tests, typed by the contract (@goshop/shared), so a
// field the API renames breaks the fixtures at compile time.
import type { Category, Product, ProductList } from "@goshop/shared";

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
};

/** A category; top-level unless `parent_id` is given. */
export const category = (
  slug: string,
  name: string,
  parent_id: string | null = null,
  id: string = nextId(),
): Category => ({ id, slug, name, parent_id });

/**
 * An in-stock product with one variant at `amount` rupiah and no photo.
 * `overrides` replaces any field.
 */
export const product = (
  name: string,
  overrides: Partial<Product> = {},
): Product => {
  const amount = overrides.price_from?.amount ?? 89_000;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: nextId(),
    slug,
    name,
    description: `${name}.`,
    category: category("kaos", "Kaos"),
    price_from: { amount, currency: "IDR" },
    in_stock: true,
    variants: [
      {
        id: nextId(),
        sku: `${slug}-m`,
        name: "M",
        price: { amount, currency: "IDR" },
        stock: 5,
      },
    ],
    images: [],
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
};

/** One page of GET /v1/products. */
export const productPage = (
  products: Product[],
  nextCursor: string | null = null,
): ProductList => ({ data: products, page: { next_cursor: nextCursor } });
