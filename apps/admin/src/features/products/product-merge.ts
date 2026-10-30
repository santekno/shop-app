import { VARIANT_STOCK_MAX, isApiError } from "@goshop/shared";
import type { ProductInput, VariantInput } from "@goshop/shared";
import { INFO_FIELDS, VARIANT_FIELDS } from "./product-form.ts";
import type { InfoField } from "./product-form.ts";

/**
 * After a 409 (Bab 12 artikel 05): what changed on the server since the
 * form loaded the product, next to what the seller changed, and the
 * form's values with both put together. Every 409 of a save comes here:
 * VERSION_CONFLICT on the product (another admin saved or archived it,
 * maybe adding or archiving variants), VERSION_CONFLICT on one variant (a
 * checkout, a cancel or a stock adjustment moved its stock), and
 * VARIANT_ARCHIVED.
 *
 * A three-way merge, the way `git merge` does it, with three copies of
 * the product:
 *
 * - base: what the form loaded (its default values; the product's
 *   `version` and each variant's come from here, which is why the save
 *   was refused);
 * - mine: what the form holds now;
 * - latest: the product as the server has it now, fetched after the 409.
 *
 * Field by field: changed only on the server → the server's value (a
 * checkout took stock, and the seller never touched that stock: it is
 * taken, never written over); changed only by the seller → the seller's;
 * changed by both to the same value → that value; changed by both to
 * different values → a conflict, and the seller chooses. The merged values
 * carry the latest versions (the product's and every variant's), so the
 * next save is checked against the server as it is now.
 *
 * Every value is compared as the schema would send it ("89.000" and
 * "89000" are one price, " kph-m " is KPH-M), so a reformatted number is
 * not a change.
 */

export type VariantField = (typeof VARIANT_FIELDS)[number];

/** How one field came out of the merge. */
export type MergeOutcome =
  /** Neither side changed it. */
  | "unchanged"
  /** Only the server changed it: the server's value is taken. */
  | "theirs"
  /** Only the seller changed it (or both, to the same value): kept. */
  | "mine"
  /** Both changed it, to different values: the seller chooses. */
  | "conflict";

/**
 * The seller's answer to a conflict: their value, the server's, or (for
 * stock only) the server's stock plus the seller's change to it.
 */
export type MergeChoice = "mine" | "theirs" | "combined";

/** One field in the three copies, as the form holds it (text). */
export interface MergeField {
  /** The key of the seller's choice: "name", or "variants.<id>.stock". */
  key: string;
  field: InfoField | VariantField;
  base: string;
  mine: string;
  theirs: string;
  outcome: MergeOutcome;
  /**
   * Stock in conflict only: the server's stock plus the seller's change
   * (latest + (mine − base)), when that is a valid stock. "I received 5"
   * typed as 10 → 15 while 2 were sold (10 → 8) becomes 13.
   */
  combined?: string;
}

/** What happened to one variant, between the three copies. */
export type VariantMergeState =
  /** In all three: merged field by field. */
  | "kept"
  /** The seller removed it (it is archived on save); the server changed it. */
  | "removed-by-me"
  /** Someone else archived it: the seller's edits to it cannot be saved. */
  | "archived-by-them"
  /** Someone else added it: kept, or the save would archive it. */
  | "added-by-them"
  /** The seller added it (no `id` yet): kept. */
  | "new";

export interface VariantMerge {
  /** Stable: the variant's id, or "new:<index>" for one the seller added. */
  key: string;
  id: string | undefined;
  state: VariantMergeState;
  /** What the seller reads: "M (KPH-M)". */
  label: string;
  /**
   * "kept": all five fields. "removed-by-me": the server's changes, with
   * `mine` empty (the seller removed it). Otherwise none.
   */
  fields: MergeField[];
  /** The variant the API named in its 409 (`details.variant_id`). */
  rejected: boolean;
  /** "added-by-them": the server's variant, as the merged form gets it. */
  latest?: VariantInput;
}

export interface ProductMerge {
  /** The first step's five fields. */
  info: MergeField[];
  /** Every variant of the three copies, the API's rejected one first. */
  variants: VariantMerge[];
  /** The server's product as form values: the merged form's new base. */
  latest: ProductInput;
  /** The seller's variants, in their order, for the merged list. */
  mine: ProductInput;
}

/** A whole number as the form holds it: "89000" or "89.000". */
const WHOLE_NUMBER_PATTERN = /^(\d+|\d{1,3}(\.\d{3})+)$/;

const NUMBER_FIELDS: ReadonlySet<string> = new Set([
  "price",
  "stock",
  "weight_grams",
]);

/**
 * A value as the schema would send it, for comparing: trimmed, a SKU in
 * capitals, a number without its thousands dots. A value the schema would
 * refuse is compared as typed (it is a change, and the save will say
 * what is wrong with it).
 */
export const normalizeMergeValue = (
  field: InfoField | VariantField,
  value: unknown,
): string => {
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  if (field === "sku") return text.toUpperCase();
  if (NUMBER_FIELDS.has(field) && WHOLE_NUMBER_PATTERN.test(text)) {
    return String(Number(text.replaceAll(".", "")));
  }
  return text;
};

const asText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Merges one field of the three copies. */
const mergeField = (
  key: string,
  field: InfoField | VariantField,
  base: unknown,
  mine: unknown,
  theirs: unknown,
): MergeField => {
  const b = normalizeMergeValue(field, base);
  const m = normalizeMergeValue(field, mine);
  const t = normalizeMergeValue(field, theirs);
  const mineChanged = m !== b;
  const theirsChanged = t !== b;
  let outcome: MergeOutcome = "unchanged";
  if (mineChanged && theirsChanged) {
    outcome = m === t ? "mine" : "conflict";
  } else if (mineChanged) {
    outcome = "mine";
  } else if (theirsChanged) {
    outcome = "theirs";
  }
  const merged: MergeField = {
    key,
    field,
    base: asText(base),
    mine: asText(mine),
    theirs: asText(theirs),
    outcome,
  };
  if (outcome === "conflict" && field === "stock") {
    const combined = Number(t) + (Number(m) - Number(b));
    if (
      [b, m, t].every((value) => /^\d+$/.test(value)) &&
      combined >= 0 &&
      combined <= VARIANT_STOCK_MAX
    ) {
      merged.combined = String(combined);
    }
  }
  return merged;
};

/** "M (KPH-M)", from whichever copy has the variant. */
const variantLabel = (variant: VariantInput): string => {
  const name = asText(variant.name).trim();
  const sku = asText(variant.sku).trim().toUpperCase();
  if (name === "") return sku === "" ? "Varian baru" : sku;
  return sku === "" ? name : `${name} (${sku})`;
};

const byId = (variants: readonly VariantInput[]) =>
  new Map(
    variants.flatMap((variant) =>
      variant.id === undefined ? [] : [[variant.id, variant] as const],
    ),
  );

interface MergeInput {
  base: ProductInput;
  mine: ProductInput;
  latest: ProductInput;
  /** `details.variant_id` of the 409, when the API named one. */
  rejectedVariantId?: string | undefined;
}

/**
 * The three-way merge of the product form after a 409. Pure: it decides
 * nothing the seller has to choose (see `applyMerge` for that).
 */
export const mergeProduct = ({
  base,
  mine,
  latest,
  rejectedVariantId,
}: MergeInput): ProductMerge => {
  const info = INFO_FIELDS.map((field) =>
    mergeField(field, field, base[field], mine[field], latest[field]),
  );

  const baseById = byId(base.variants);
  const mineById = byId(mine.variants);
  const latestById = byId(latest.variants);
  const variants: VariantMerge[] = [];

  const mergeVariantFields = (
    id: string,
    from: VariantInput,
    to: VariantInput,
    against: VariantInput,
  ) =>
    VARIANT_FIELDS.map((field) =>
      mergeField(
        `variants.${id}.${field}`,
        field,
        from[field],
        to[field],
        against[field],
      ),
    );

  // The seller's list first, in its order.
  mine.variants.forEach((variant, index) => {
    const id = variant.id;
    if (id === undefined) {
      variants.push({
        key: `new:${index}`,
        id: undefined,
        state: "new",
        label: variantLabel(variant),
        fields: [],
        rejected: false,
      });
      return;
    }
    const before = baseById.get(id) ?? variant;
    const now = latestById.get(id);
    variants.push({
      key: id,
      id,
      state: now === undefined ? "archived-by-them" : "kept",
      label: variantLabel(variant),
      fields:
        now === undefined ? [] : mergeVariantFields(id, before, variant, now),
      rejected: id === rejectedVariantId,
    });
  });

  // Loaded, then removed by the seller: archived on save, whatever the
  // server did to it meanwhile, which the review shows.
  for (const [id, before] of baseById) {
    if (mineById.has(id)) continue;
    const now = latestById.get(id);
    variants.push({
      key: id,
      id,
      state: now === undefined ? "archived-by-them" : "removed-by-me",
      label: variantLabel(before),
      fields:
        now === undefined
          ? []
          : mergeVariantFields(id, before, before, now).map((field) => ({
              ...field,
              mine: "",
            })),
      rejected: id === rejectedVariantId,
    });
  }

  // On the server, never loaded: someone else added it.
  for (const [id, now] of latestById) {
    if (baseById.has(id) || mineById.has(id)) continue;
    variants.push({
      key: id,
      id,
      state: "added-by-them",
      label: variantLabel(now),
      fields: [],
      rejected: false,
      latest: now,
    });
  }

  // The variant the API refused is the one the seller reads first.
  variants.sort((a, b) => Number(b.rejected) - Number(a.rejected));
  return { info, variants, latest, mine };
};

/** Every field of the merge, the variants' included. */
const allFields = (merge: ProductMerge): MergeField[] => [
  ...merge.info,
  ...merge.variants.flatMap((variant) =>
    variant.state === "kept" ? variant.fields : [],
  ),
];

/** The conflicts the seller has not chosen for yet, by key. */
export const missingChoices = (
  merge: ProductMerge,
  choices: Readonly<Record<string, MergeChoice>>,
): string[] =>
  allFields(merge)
    .filter((field) => field.outcome === "conflict")
    .map((field) => field.key)
    .filter((key) => choices[key] === undefined);

/** How many things the server changed: fields, and whole variants. */
export const serverChangeCount = (merge: ProductMerge): number =>
  merge.info.filter(
    (field) => field.outcome === "theirs" || field.outcome === "conflict",
  ).length +
  merge.variants.reduce((count, variant) => {
    switch (variant.state) {
      case "kept":
        return (
          count +
          variant.fields.filter(
            (field) =>
              field.outcome === "theirs" || field.outcome === "conflict",
          ).length
        );
      case "removed-by-me":
        return (
          count +
          variant.fields.filter((field) => field.outcome === "theirs").length
        );
      case "archived-by-them":
      case "added-by-them":
        return count + 1;
      case "new":
        return count;
    }
  }, 0);

/** The value a field takes in the merged form. */
const resolveField = (
  field: MergeField,
  choices: Readonly<Record<string, MergeChoice>>,
): string => {
  switch (field.outcome) {
    case "unchanged":
    case "mine":
      return field.mine;
    case "theirs":
      return field.theirs;
    case "conflict": {
      const choice = choices[field.key];
      if (choice === "mine") return field.mine;
      if (choice === "combined" && field.combined !== undefined) {
        return field.combined;
      }
      // No choice (the caller checks `missingChoices` first): the
      // server's value, which overwrites nothing.
      return field.theirs;
    }
  }
};

/**
 * The form's values after "keep my changes": the seller's changes on top
 * of the server's product, the conflicts as chosen, the product's latest
 * `version`, and every existing variant with its latest `version`.
 *
 * - The seller's variants keep their order; one archived by someone else
 *   is left out (it can no longer be saved: an archived variant cannot be
 *   written, and its SKU stays taken).
 * - A variant someone else added goes at the end, unchanged: leaving it
 *   out would archive it on save.
 * - A variant the seller removed stays removed (archived on save).
 */
export const applyMerge = (
  merge: ProductMerge,
  choices: Readonly<Record<string, MergeChoice>>,
): ProductInput => {
  const info = Object.fromEntries(
    merge.info.map((field) => [field.field, resolveField(field, choices)]),
  ) as Pick<ProductInput, InfoField>;
  const states = new Map(
    merge.variants.map((variant) => [variant.key, variant]),
  );
  const latestById = byId(merge.latest.variants);

  const variants: VariantInput[] = [];
  for (const variant of merge.mine.variants) {
    if (variant.id === undefined) {
      variants.push(variant);
      continue;
    }
    const state = states.get(variant.id);
    const latest = latestById.get(variant.id);
    if (state?.state !== "kept" || latest === undefined) continue;
    const merged: VariantInput = { ...variant, id: variant.id };
    merged.version = latest.version;
    for (const field of state.fields) {
      merged[field.field as VariantField] = resolveField(field, choices);
    }
    variants.push(merged);
  }
  for (const variant of merge.variants) {
    if (variant.state === "added-by-them" && variant.latest !== undefined) {
      variants.push(variant.latest);
    }
  }
  return { ...merge.mine, ...info, version: merge.latest.version, variants };
};

/** Why the API refused the save, as the review explains it. */
export interface ConflictCause {
  /**
   * - "product": VERSION_CONFLICT with `details.product_id`. Another
   *   admin saved the product (its fields, or added or archived variants)
   *   or archived it. Checked first by the API.
   * - "variant": VERSION_CONFLICT with `details.variant_id`. Only that
   *   variant's stock can have moved (a checkout, a cancel, a stock
   *   adjustment): anything else would have moved the product's version.
   * - "archived": VARIANT_ARCHIVED with `details.variant_id`. Not how a
   *   concurrent archive shows up: every archive goes through a save,
   *   which bumps the product's version, so a form that loaded the
   *   product before another admin archived a variant gets "product"
   *   first. This is the API's fallback for a body that sends the current
   *   product version with a variant that was already archived when the
   *   variants were read (a body built from an older copy of them). The
   *   review merges it like the others: the variant is dropped.
   */
  kind: "product" | "variant" | "archived";
  /** `details.variant_id`, the variant the API named first ("variant", "archived"). */
  variantId?: string | undefined;
}

/**
 * The cause of a 409 from PUT /v1/admin/products/{id}. A VERSION_CONFLICT
 * that names no variant is the product's (`details.product_id`).
 */
export const conflictCause = (error: unknown): ConflictCause => {
  if (isApiError(error, "VARIANT_ARCHIVED", "VERSION_CONFLICT")) {
    const id = error.details.variant_id;
    const variantId = typeof id === "string" ? id : undefined;
    if (error.code === "VARIANT_ARCHIVED") {
      return { kind: "archived", variantId };
    }
    if (variantId !== undefined) return { kind: "variant", variantId };
  }
  return { kind: "product" };
};
