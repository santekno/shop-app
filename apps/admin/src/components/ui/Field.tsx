import { useId } from "react";
import type { ReactNode } from "react";
import { Label } from "./Label.tsx";

/** The props a Field gives its control, to spread onto it. */
export interface FieldControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

interface FieldProps {
  label: string;
  /** A short help text under the control. */
  hint?: ReactNode;
  /** What is wrong with the value; marks the control invalid. */
  error?: string | undefined;
  /** Renders the control with the ids that tie it to its label and texts. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * TextField's label, hint and error around any control (a <select>, a
 * <textarea>): the same ids and ARIA, with the control left to the caller.
 * A render prop, because the control needs the generated ids:
 *
 *   <Field label="Kategori" error={errors.category_id?.message}>
 *     {(control) => <NativeSelect {...control} {...register("category_id")} />}
 *   </Field>
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value) => value !== undefined)
    .join(" ");

  return (
    <div className="grid w-full gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": error === undefined ? undefined : true,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="field__error text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
