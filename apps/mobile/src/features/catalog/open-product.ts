import { router } from "expo-router";
import type { Product } from "@goshop/shared";

// A typed href: with typed routes on, a pathname that is not a route, or a
// missing slug, is a compile error. The detail screen is pushed on the root
// stack, above the tab bar. A function outside any component, so a memo
// card that receives it as `onPress` is never re-rendered because of it.
export const openProduct = (product: Product) => {
  router.push({ pathname: "/produk/[slug]", params: { slug: product.slug } });
};
