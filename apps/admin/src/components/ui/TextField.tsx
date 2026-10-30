import { useId } from "react";
import type { ComponentProps } from "react";
import { Input } from "./Input.tsx";
import { Label } from "./Label.tsx";

interface TextFieldProps extends ComponentProps<"input"> {
  label: string;
  /** A short help text under the input, such as the password rule. */
  hint?: string | undefined;
  /** What is wrong with the value; shows the field as invalid. */
  error?: string | undefined;
}

/**
 * A labelled input with its hint and error.
 *
 * - <label htmlFor> names the input: a click on the label focuses it, and
 *   a screen reader reads the label with the field.
 * - aria-describedby points at the hint and the error, so they are read
 *   after the label; aria-invalid says the value was refused.
 * - Every other prop goes to the <input>, `ref` included (in React 19 a
 *   ref is an ordinary prop): React Hook Form's register() spreads
 *   name, onChange, onBlur and ref into it.
 */
export function TextField({
  label,
  hint,
  error,
  id,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value) => value !== undefined)
    .join(" ");

  return (
    <div className="grid w-full gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...inputProps}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        // field__error: a hook for the tests; text-destructive styles it.
        <p id={errorId} className="field__error text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
