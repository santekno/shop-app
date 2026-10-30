import { useCallback } from "react";
import { useFormContext } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import type { ProductInput, ProductWrite } from "@goshop/shared";

/**
 * `register` for the product form's inputs, with one addition: a field
 * that shows an error is checked again on every change, so the message
 * goes away as soon as the value is right.
 *
 * Why not one of React Hook Form's modes. The form validates late, when
 * the seller presses "Lanjut" (ProductForm's goTo) or saves, never on
 * blur: a message that appears when a field loses the focus pushes the
 * rest of the form down at the moment the seller clicks the next control,
 * and the click lands on whatever moved under the pointer ("Hapus" on a
 * variant missed exactly so). "onChange" would flash errors while a value
 * is half typed ("89." on the way to "89.000"). So: quiet until asked,
 * then re-checked early, field by field ("reward early, punish late").
 */
export const useProductField = () => {
  const { register, getFieldState, trigger } = useFormContext<
    ProductInput,
    unknown,
    ProductWrite
  >();

  return useCallback(
    (
      name: FieldPath<ProductInput>,
      options: {
        onChange?: (event: { target: { value: string } }) => void;
      } = {},
    ) =>
      register(name, {
        onChange: (event: { target: { value: string } }) => {
          options.onChange?.(event);
          if (getFieldState(name).invalid) void trigger(name);
        },
      }),
    [register, getFieldState, trigger],
  );
};
