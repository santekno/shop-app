// A step of the product form on its own, inside React Hook Form with the
// product schema, the way ProductForm provides it: for the artikel 05
// tests of the steps' `loaded` prop (what the form loaded, to archive).
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { productSchema } from "@goshop/shared";
import type { ProductInput, ProductWrite } from "@goshop/shared";

export function ProductFormHarness({
  values,
  children,
}: {
  values: ProductInput;
  children: ReactNode;
}) {
  const form = useForm<ProductInput, unknown, ProductWrite>({
    resolver: zodResolver(productSchema),
    defaultValues: values,
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}
