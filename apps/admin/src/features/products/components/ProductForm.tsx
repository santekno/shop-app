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
import {
  applyMerge,
  conflictVariantId,
  mergeProduct,
} from "../product-merge.ts";
import type { MergeChoice } from "../product-merge.ts";
import { ProductConflictReview } from "./ProductConflictReview.tsx";
import type { ConflictReviewState } from "./ProductConflictReview.tsx";
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
   * Edit only: fetch the product as the server has it now. Called after a
   * 409 VERSION_CONFLICT, to show what changed (artikel 05).
   */
  loadLatest?: () => Promise<AdminProduct>;
  /**
   * Edit only: the product as the page's query has it now (refetched in
   * the background, or replaced by a quick stock change). A form with no
   * changes follows it; a form with changes keeps them and says the
   * server moved.
   */
  latest?: AdminProduct | undefined;
  /** Where "Batal" goes. */
  cancelTo: string;
}

/** The conflict review, with what it needs to fetch again. */
type ConflictReview = ConflictReviewState & {
  rejectedVariantId: string | undefined;
};

/** A product's form values as one comparable string. */
const valuesKey = (values: ProductInput) => JSON.stringify(values);

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
 * the focus on the field.
 *
 * A 409 (the product changed on the server since the form loaded it)
 * replaces the form with a review of what changed (artikel 05): the
 * seller's changes put on top of the latest product, or dropped. The
 * form's values survive the review (React Hook Form keeps them while no
 * input is on screen).
 */
export function ProductForm({
  mode,
  defaultValues,
  onSave,
  onSaved,
  loadLatest,
  latest,
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
    formState: { defaultValues: loaded, errors, isDirty, isSubmitting },
  } = form;
  // What the form started from: the loaded product, or the last product
  // it was reset to (a save, a merge). The schema's input type, partial
  // only in React Hook Form's typing: every reset below passes a whole
  // product. Each variant's `version` is read from here.
  const base = loaded as ProductInput;

  const [step, setStep] = useState(0);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [review, setReview] = useState<ConflictReview | null>(null);
  const [notice, setNotice] = useState<string>();
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

  // The server's product changed (a background refetch, a quick stock
  // change on this page). A form with no changes takes it, versions
  // included, so its next save is not refused for nothing; a form with
  // changes keeps them, because they are the seller's (a 409 then shows
  // both). Compared as values: a refetch that changed nothing does
  // nothing.
  const serverMoved =
    latest !== undefined &&
    valuesKey(productToFormValues(latest)) !== valuesKey(base);
  useEffect(() => {
    if (latest === undefined || !serverMoved) return;
    if (isDirty || isSubmitting || review !== null) return;
    reset(productToFormValues(latest));
  }, [latest, serverMoved, isDirty, isSubmitting, review, reset]);

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
    if (result.conflict) {
      void openReview(conflictVariantId(error));
      return;
    }
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

  /**
   * The save was refused because the product changed on the server:
   * fetch it as it is now, and show the three copies side by side (what
   * the form loaded, what the seller changed, what the server has).
   */
  const openReview = async (rejectedVariantId: string | undefined) => {
    if (loadLatest === undefined) return;
    setReview({ status: "loading", rejectedVariantId });
    try {
      const now = await loadLatest();
      setReview({
        status: "ready",
        rejectedVariantId,
        merge: mergeProduct({
          base,
          mine: getValues(),
          latest: productToFormValues(now),
          rejectedVariantId,
        }),
      });
    } catch (error) {
      setReview({ status: "error", error, rejectedVariantId });
    }
  };

  /**
   * "Terapkan perubahan saya": the latest product becomes the form's
   * starting point (its versions are what the next save sends), and the
   * merged values go on top of it, so the form is dirty with exactly the
   * seller's changes. Two resets: the first sets the new defaults, the
   * second the values while keeping those defaults.
   */
  const keepMine = (choices: Record<string, MergeChoice>) => {
    if (review?.status !== "ready") return;
    const merged = applyMerge(review.merge, choices);
    reset(review.merge.latest);
    reset(merged, { keepDefaultValues: true });
    setReview(null);
    setNotice(
      "Perubahan Anda diterapkan ke data terbaru. Periksa hasilnya, lalu simpan.",
    );
    show(REVIEW_STEP);
  };

  /** "Buang perubahan saya": the form becomes the latest product. */
  const discardMine = () => {
    if (review?.status !== "ready") return;
    reset(review.merge.latest);
    setReview(null);
    setNotice("Perubahan Anda dibuang. Formulir berisi data terbaru.");
    show(0);
  };

  const save = async (body: ProductWrite) => {
    setNotice(undefined);
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
  // Edit only: the variants as loaded, for "akan diarsipkan" and the
  // stock each one had.
  const loadedVariants = mode === "edit" ? base.variants : [];

  // Asks before a navigation away from unsaved changes; rendered with
  // the form and with the review alike, since both have something to lose.
  const leaveDialog = (
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
  );

  if (review !== null) {
    return (
      <>
        <Card>
          <ProductConflictReview
            state={review}
            onRetry={() => void openReview(review.rejectedVariantId)}
            onKeepMine={keepMine}
            onDiscard={discardMine}
          />
        </Card>
        {leaveDialog}
      </>
    );
  }

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

          <p role="status" className="empty:hidden">
            {notice}
          </p>
          {serverMoved && isDirty && (
            <p className="rounded-md border border-border bg-muted p-3 text-sm">
              Produk ini berubah di server sejak Anda mulai mengubahnya
              (misalnya stok terjual). Lanjutkan saja: saat Anda menyimpan,
              perubahan itu ditampilkan berdampingan dengan perubahan Anda.
            </p>
          )}

          {step === 0 && <ProductInfoStep mode={mode} />}
          {step === 1 && (
            <ProductVariantsStep mode={mode} loaded={loadedVariants} />
          )}
          {step === REVIEW_STEP && (
            <ProductReviewStep
              mode={mode}
              loaded={loadedVariants}
              onEdit={(index) => {
                show(index);
              }}
            />
          )}

          <div className="grid justify-items-start gap-2">
            {/* Takes the focus when it appears: the save button was
                disabled while the request ran. */}
            <FormAlert error={errors.root?.server} />
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

      {leaveDialog}
    </FormProvider>
  );
}
