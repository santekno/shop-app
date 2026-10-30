/**
 * The product form's pages, loaded on demand, like the login page
 * (features/auth/lazy.ts): the form, React Hook Form, Zod and the product
 * schema are downloaded the first time a seller opens "Tambah produk" or a
 * product, not by everyone who opens the dashboard. The table, the
 * dashboard's most used page, stays in the main bundle.
 */
export const loadProductCreatePage = () =>
  import("./components/ProductCreatePage.tsx");
export const loadProductEditPage = () =>
  import("./components/ProductEditPage.tsx");
