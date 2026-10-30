// Form values for the artikel 05 tests (stock, the three-way merge after
// a 409): a product as React Hook Form holds it (text numbers), built
// from the API's shape so ids and versions line up with the fixtures.
import type { AdminProduct, ProductInput, VariantInput } from "@goshop/shared";
import { productToFormValues } from "@/features/products/product-form.ts";
import { adminProduct, adminVariant } from "./fixtures.ts";

/** A product's form values, as productToFormValues gives them. */
export const formValues = (
  overrides: Partial<AdminProduct> = {},
): ProductInput => productToFormValues(adminProduct(overrides));

/** Form values with two variants: 1 (M, stock 12) and 2 (L, stock 4). */
export const twoVariantForm = (): ProductInput =>
  formValues({
    variants: [
      adminVariant(1, { name: "M", sku: "KAOS-M", stock: 12 }),
      adminVariant(2, { name: "L", sku: "KAOS-L", stock: 4 }),
    ],
  });

/** `values` with variant `index` changed by `patch`. */
export const withVariant = (
  values: ProductInput,
  index: number,
  patch: Partial<VariantInput>,
): ProductInput => ({
  ...values,
  variants: values.variants.map((variant, at) =>
    at === index ? { ...variant, ...patch } : variant,
  ),
});
