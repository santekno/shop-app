import { useEffect, useId, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import { Link } from "react-router";
import { productSchema } from "@goshop/shared";
import type { AdminProduct, ProductInput, ProductWrite } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { FormAlert } from "@/components/ui/FormAlert.tsx";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard.ts";
import {
  INFO_FIELDS,
  PRODUCT_FORM_STEPS,
  REVIEW_STEP,
  VARIANT_FIELDS,
  productToFormValues,
  stepOfField,
  toProductApiErrors,
} from "../product-form.ts";
import { ProductInfoStep } from "./ProductInfoStep.tsx";
import { ProductReviewStep } from "./ProductReviewStep.tsx";
import { ProductVariantsStep } from "./ProductVariantsStep.tsx";
import { StepIndicator } from "./StepIndicator.tsx";

/** Create a product, or edit one that exists. */
export type ProductFormMode = "create" | "edit";

type ProductFieldPath = FieldPath<ProductInput>;

interface ProductFormProps {
  mode: ProductFormMode;
  /** The values the form starts with; read once, when it mounts. */
  defaultValues: ProductInput;
  /** Sends the product (POST or PUT); rejects with the API's error. */
  onSave: (body: ProductWrite) => Promise<AdminProduct>;
  /** After a successful save: the page decides what comes next. */
  onSaved: (product: AdminProduct) => void;
  /**
   * Edit only: fetch the product again after a 409 VERSION_CONFLICT and
   * start over from it (the page remounts the form).
   */
  onReload?: () => void;
  /** Where "Batal" goes. */
  cancelTo: string;
}

/** Where the focus goes after the step changes: a field, or the heading. */
interface FocusRequest {
  field?: ProductFieldPath;
}

/**
 * The product form in three steps: Info dasar → Varian & harga → Tinjau.
 *
 * One form, not three. React Hook Form holds every value for the whole
 * product from the first render; a step only decides which inputs are on
 * screen. A step that leaves the screen keeps its values (React Hook
 * Form's default `shouldUnregister: false`), so Back and Forward never lose
 * anything, and the save sends what every step collected.
 *
 * One schema, checked a step at a time. `productSchema` (from
 * @goshop/shared, matching ProductWrite in the contract) is the resolver;
 * "Lanjut" calls `trigger(fields of this step)`, which runs the schema and
 * reports only those fields. The save runs it whole once more, and the
 * output (numbers parsed, SKUs upper-cased, text trimmed) is the body.
 *
 * The API has the last word. Its field errors land on their fields, on
 * whichever step they are: the form goes to the first such step and puts
 * the focus on the field. A 409 is shown for the whole form.
 */
export function ProductForm({
  mode,
  defaultValues,
  onSave,
  onSaved,
  onReload,
  cancelTo,
}: ProductFormProps) {
  const form = useForm({
    resolver: zodResolver(productSchema),
    defaultValues,
    // Validated when the seller moves on ("Lanjut", goTo) or saves, not
    // on blur; a field with an error is re-checked on every change
    // (useProductField). After a save attempt every field is re-checked
    // on change (reValidateMode, "onChange" by default).
    mode: "onSubmit",
  });
  const {
    getFieldState,
    getValues,
    handleSubmit,
    reset,
    setError,
    setFocus,
    trigger,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  const [step, setStep] = useState(0);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [conflict, setConflict] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const { blocker, allowNavigation } = useUnsavedChangesGuard(isDirty);

  // After a step change asked for it: focus the field with the error, or
  // the new step's heading, so a screen reader reads where it is and Tab
  // continues from there. Not on the first render: the page's <h1> has
  // the focus then (useRouteFocus).
  useEffect(() => {
    if (focusRequest === null) return;
    if (focusRequest.field === undefined) {
      headingRef.current?.focus();
    } else {
      setFocus(focusRequest.field, { shouldSelect: false });
    }
  }, [focusRequest, setFocus]);

  /** Shows a step, and moves the focus to `field` or the step's heading. */
  const show = (index: number, field?: ProductFieldPath) => {
    setStep(index);
    setFocusRequest(field === undefined ? {} : { field });
  };

  /** Every input of a step, in screen order. */
  const fieldsOfStep = (index: number): ProductFieldPath[] => {
    if (index === 0) return [...INFO_FIELDS];
    if (index !== 1) return [];
    return getValues("variants").flatMap((_, variant) =>
      VARIANT_FIELDS.map((field) => `variants.${variant}.${field}` as const),
    );
  };

  /** The first field of a step that has an error, in screen order. */
  const firstInvalidField = (index: number): ProductFieldPath | undefined =>
    fieldsOfStep(index).find((field) => getFieldState(field).invalid);

  /**
   * Goes to step `target`. Backwards is always allowed. Forwards, every
   * step on the way is validated first; the first one with an error is
   * shown instead, with the focus on its first invalid field.
   */
  const goTo = async (target: number) => {
    if (target <= step) {
      show(target);
      return;
    }
    for (let index = step; index < target; index++) {
      const fields = PRODUCT_FORM_STEPS[index]?.fields ?? [];
      if (!(await trigger([...fields]))) {
        show(index, firstInvalidField(index));
        return;
      }
    }
    show(target);
  };

  /** Puts the API's error where the seller can act on it. */
  const showApiErrors = (error: unknown) => {
    const result = toProductApiErrors(error);
    for (const { name, message } of result.fields) {
      setError(name as ProductFieldPath, { type: "server", message });
    }
    if (result.variants !== undefined) {
      setError("root.variants", { type: "server", message: result.variants });
    }
    if (result.form !== undefined) {
      setError("root.server", { type: "server", message: result.form });
    }
    setConflict(result.conflict);
    if (result.fields.length > 0) {
      // The earliest step with an error, and its first field on screen
      // (the API's order is alphabetical, not the form's).
      const target = Math.min(
        ...result.fields.map(({ name }) => stepOfField(name)),
      );
      show(target, firstInvalidField(target));
    } else if (result.variants !== undefined) {
      show(1);
    }
    // Otherwise FormAlert takes the focus itself.
  };

  const save = async (body: ProductWrite) => {
    setConflict(false);
    try {
      const saved = await onSave(body);
      // The create page goes on to the new product's page: nothing is
      // lost, so the guard must not ask (isDirty is still true until the
      // next render).
      if (mode === "create") allowNavigation();
      // The saved product as the new starting point: not dirty any more,
      // and an edit form holds the variants' new versions for its next PUT.
      reset(productToFormValues(saved));
      onSaved(saved);
    } catch (error) {
      showApiErrors(error);
    }
  };

  /** The save found an invalid field (a step skipped): show its step. */
  const onInvalid = () => {
    const index = PRODUCT_FORM_STEPS.findIndex(
      (_, stepIndex) => firstInvalidField(stepIndex) !== undefined,
    );
    const target = index === -1 ? 1 : index;
    show(target, firstInvalidField(target));
  };

  const currentStep = PRODUCT_FORM_STEPS[step] ?? PRODUCT_FORM_STEPS[0];

  return (
    <FormProvider {...form}>
      <StepIndicator
        steps={PRODUCT_FORM_STEPS}
        current={step}
        onSelect={(index) => void goTo(index)}
      />
      <Card>
        {/* noValidate: the form shows its own messages, linked to each
            field, instead of the browser's bubbles. Enter in a field is
            "Lanjut" on the first two steps and "Simpan" on the last. */}
        <form
          noValidate
          aria-labelledby={headingId}
          className="grid gap-6"
          onSubmit={(event) => {
            if (step < REVIEW_STEP) {
              event.preventDefault();
              void goTo(step + 1);
              return;
            }
            void handleSubmit(save, onInvalid)(event);
          }}
        >
          <div className="grid gap-1">
            <h2 ref={headingRef} id={headingId} tabIndex={-1}>
              {currentStep.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              Langkah {step + 1} dari {PRODUCT_FORM_STEPS.length}
            </p>
          </div>

          {step === 0 && <ProductInfoStep mode={mode} />}
          {step === 1 && <ProductVariantsStep mode={mode} />}
          {step === REVIEW_STEP && (
            <ProductReviewStep
              mode={mode}
              onEdit={(index) => {
                show(index);
              }}
            />
          )}

          <div className="grid justify-items-start gap-2">
            {/* Takes the focus when it appears: the save button was
                disabled while the request ran. */}
            <FormAlert error={errors.root?.server} />
            {conflict && onReload !== undefined && (
              <Button variant="outline" onClick={onReload}>
                Muat ulang data terbaru
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            {step > 0 ? (
              <Button
                variant="outline"
                onClick={() => {
                  show(step - 1);
                }}
              >
                Kembali
              </Button>
            ) : (
              <Button asChild variant="ghost">
                <Link to={cancelTo}>Batal</Link>
              </Button>
            )}
            {step < REVIEW_STEP ? (
              <Button type="submit">Lanjut</Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Menyimpan…"
                  : mode === "create"
                    ? "Buat produk"
                    : "Simpan perubahan"}
              </Button>
            )}
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Tinggalkan halaman ini?"
        confirmLabel="Tinggalkan"
        cancelLabel="Tetap di sini"
        destructive
        onConfirm={() => {
          blocker.proceed?.();
        }}
        onCancel={() => {
          blocker.reset?.();
        }}
      >
        <p>Perubahan pada produk ini belum disimpan dan akan hilang.</p>
      </ConfirmDialog>
    </FormProvider>
  );
}
