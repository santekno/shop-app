import { useEffect, useId, useRef, useState } from "react";
import { formatRupiah } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { useCategoryOptions } from "../hooks/useCategoryOptions.ts";
import {
  missingChoices,
  normalizeMergeValue,
  serverChangeCount,
} from "../product-merge.ts";
import type {
  ConflictCause,
  MergeChoice,
  MergeField,
  ProductMerge,
  VariantMerge,
} from "../product-merge.ts";
import { STATUS_OPTIONS } from "../product-table-params.ts";

/** Where the review is: fetching the product again, failed, or ready. */
export type ConflictReviewState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; merge: ProductMerge };

interface ProductConflictReviewProps {
  state: ConflictReviewState;
  /** Why the API refused the save: the product, one variant, an archived variant. */
  cause: ConflictCause;
  /** Fetch the product again (after a failed fetch). */
  onRetry: () => void;
  /** Put the seller's changes on top of the latest product, as chosen. */
  onKeepMine: (choices: Record<string, MergeChoice>) => void;
  /** Drop the seller's changes: the form becomes the latest product. */
  onDiscard: () => void;
}

const FIELD_LABELS: Record<MergeField["field"], string> = {
  name: "Nama",
  slug: "Slug",
  category_id: "Kategori",
  status: "Status",
  description: "Deskripsi",
  sku: "SKU",
  price: "Harga",
  stock: "Stok",
  weight_grams: "Berat",
};

/** At most this many characters of a description in the table. */
const DESCRIPTION_PREVIEW = 120;

/**
 * What happened on the server, by the 409's cause, and why that refused
 * the save. The API checks the product's version first, so a conflict on
 * one variant means only its stock moved: any admin save would have moved
 * the product's version. VARIANT_ARCHIVED is not a race (an archive by
 * another admin moves the product's version, so it is a product
 * conflict): the form sent a variant that was already archived, from a
 * copy of the variants older than the product's version it sent.
 */
const CAUSE_TEXT: Record<ConflictCause["kind"], string> = {
  product:
    "Sementara Anda mengubah formulir, admin lain menyimpan atau mengarsipkan produk ini: isiannya, harganya, atau daftar variannya (varian ditambah atau diarsipkan). Menyimpan formulir Anda apa adanya akan menimpa perubahan itu, jadi server menolaknya.",
  variant:
    "Sementara Anda mengubah formulir, stok varian di bawah berubah di server: pembelian menguranginya, pesanan yang dibatalkan mengembalikannya, atau stok diubah lewat panel Stok. Menyimpan formulir Anda apa adanya akan menimpa perubahan itu, jadi server menolaknya.",
  archived:
    "Formulir Anda masih memuat varian yang di server sudah diarsipkan. Varian yang diarsipkan tidak dapat disimpan lagi, jadi server menolak penyimpanan ini.",
};

/**
 * After a save was refused because the product changed on the server
 * (409 VERSION_CONFLICT on the product or on one variant, or
 * VARIANT_ARCHIVED): what changed, next to what the seller changed, and
 * two ways on. The opening sentence says which, from `cause`; everything
 * else is the same merge.
 *
 * - "Terapkan perubahan saya ke data terbaru": the seller's changes on top
 *   of the product as the server has it now. What only the server changed
 *   (the stock a checkout took) is taken, never written over; what both
 *   changed is the seller's choice, field by field. The form then shows
 *   "Tinjau" with the merged product, to save from there.
 * - "Buang perubahan saya": the form becomes the product as it is now.
 *
 * Nothing is saved by either: the seller always sees the result first.
 *
 * Per field, four columns: "Saat dibuka" (the form's starting point),
 * "Perubahan Anda", "Di server sekarang", and which of the two is kept is
 * written in the cell ("dipakai"), never shown by colour alone. A conflict
 * is a radio group under its variant's table; nothing is pre-selected, so
 * a choice is always the seller's. The heading takes the focus when the
 * review opens: a screen reader reads that the save did not happen.
 */
export function ProductConflictReview({
  state,
  cause,
  onRetry,
  onKeepMine,
  onDiscard,
}: ProductConflictReviewProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const categories = useCategoryOptions();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  /** A field's value as a seller reads it. */
  const display = (field: MergeField["field"], value: string): string => {
    const text = value.trim();
    if (text === "") return "—";
    const normal = normalizeMergeValue(field, text);
    const number = /^\d+$/.test(normal) ? Number(normal) : undefined;
    switch (field) {
      case "price":
        return number === undefined
          ? text
          : formatRupiah({ amount: number, currency: "IDR" });
      case "stock":
        return number === undefined ? text : number.toLocaleString("id-ID");
      case "weight_grams":
        return number === undefined
          ? text
          : `${number.toLocaleString("id-ID")} g`;
      case "status":
        return (
          STATUS_OPTIONS.find((option) => option.value === text)?.label ?? text
        );
      case "category_id":
        return (
          categories.data?.find((option) => option.id === text)?.name ?? text
        );
      case "description":
        return text.length > DESCRIPTION_PREVIEW
          ? `${text.slice(0, DESCRIPTION_PREVIEW)}…`
          : text;
      case "name":
      case "slug":
      case "sku":
        return normal;
    }
  };

  return (
    <section aria-labelledby={headingId} className="grid gap-6">
      {/*
        One heading, in one place, for every state: it takes the focus when
        the review opens (while it loads), and only what is under it
        changes. A second heading for "ready" would be a new element, and
        the focus would fall to <body>.
      */}
      <h2 ref={headingRef} id={headingId} tabIndex={-1}>
        Produk ini berubah sejak Anda membukanya
      </h2>
      {state.status === "loading" ? (
        <LoadingState>Memuat data terbaru dari server…</LoadingState>
      ) : state.status === "error" ? (
        <ErrorState error={state.error} onRetry={onRetry} />
      ) : (
        <ConflictReviewBody
          merge={state.merge}
          cause={cause}
          display={display}
          onKeepMine={onKeepMine}
          onDiscard={onDiscard}
        />
      )}
    </section>
  );
}

interface ConflictReviewBodyProps {
  merge: ProductMerge;
  cause: ConflictCause;
  display: (field: MergeField["field"], value: string) => string;
  onKeepMine: (choices: Record<string, MergeChoice>) => void;
  onDiscard: () => void;
}

/** The ready review: what changed, the choices, and the two ways on. */
function ConflictReviewBody({
  merge,
  cause,
  display,
  onKeepMine,
  onDiscard,
}: ConflictReviewBodyProps) {
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [missing, setMissing] = useState<string[]>([]);

  const changes = serverChangeCount(merge);
  const conflictCount = [
    ...merge.info,
    ...merge.variants.flatMap((variant) => variant.fields),
  ].filter((field) => field.outcome === "conflict").length;
  const infoShown = merge.info.some((field) => field.outcome !== "unchanged");
  const newVariants = merge.variants.filter(
    (variant) => variant.state === "new",
  );
  const variantsShown = merge.variants.filter(
    (variant) =>
      variant.state !== "new" &&
      (variant.state !== "kept" ||
        variant.rejected ||
        variant.fields.some((field) => field.outcome !== "unchanged")),
  );

  const choose = (key: string, choice: MergeChoice) => {
    setChoices((current) => ({ ...current, [key]: choice }));
    setMissing((current) => current.filter((item) => item !== key));
  };

  const keepMine = () => {
    const open = missingChoices(merge, choices);
    setMissing(open);
    if (open.length > 0) {
      // The first group without an answer: its first radio.
      const first = document.querySelector<HTMLInputElement>(
        `input[data-choice-key="${CSS.escape(open[0] ?? "")}"]`,
      );
      if (first === null) alertRef.current?.focus();
      else first.focus();
      return;
    }
    onKeepMine(choices);
  };

  return (
    <>
      <div className="grid gap-2">
        <p>
          <strong>Belum ada yang tersimpan.</strong> {CAUSE_TEXT[cause.kind]}
        </p>
        <p className="text-sm text-muted-foreground">
          {changes === 0
            ? "Nilai di server sama dengan saat Anda membukanya; hanya versinya yang berubah. Perubahan Anda bisa langsung diterapkan."
            : `${changes.toLocaleString("id-ID")} perubahan di server${
                conflictCount > 0
                  ? `, ${conflictCount.toLocaleString("id-ID")} di antaranya pada isian yang juga Anda ubah: pilih nilai yang disimpan`
                  : ", tidak ada yang bentrok dengan perubahan Anda"
              }.`}
        </p>
      </div>

      {infoShown && (
        <ChangeGroup
          title="Info dasar"
          fields={merge.info.filter((field) => field.outcome !== "unchanged")}
          display={display}
          choices={choices}
          missing={missing}
          onChoose={choose}
        />
      )}

      {variantsShown.map((variant) => (
        <ChangeGroup
          key={variant.key}
          title={`Varian ${variant.label}`}
          subject={variant.label}
          note={variantNote(variant, display)}
          fields={variant.fields.filter(
            (field) => field.outcome !== "unchanged",
          )}
          display={display}
          choices={choices}
          missing={missing}
          onChoose={choose}
          removed={variant.state === "removed-by-me"}
        />
      ))}

      {newVariants.length > 0 && (
        <p className="text-sm">
          Varian baru Anda ({newVariants.map(({ label }) => label).join(", ")})
          tetap ditambahkan.
        </p>
      )}

      <div className="grid justify-items-start gap-2">
        {missing.length > 0 && (
          <p
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            className="text-destructive"
          >
            Pilih nilai yang disimpan untuk {missing.length} isian yang bentrok.
          </p>
        )}
      </div>

      <div className="grid gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={keepMine}>
            Terapkan perubahan saya ke data terbaru
          </Button>
          <Button variant="outline" onClick={onDiscard}>
            Buang perubahan saya
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Keduanya belum menyimpan apa pun: Anda melihat hasilnya di langkah
          Tinjau, lalu menyimpan. Nilai yang hanya diubah server, seperti stok
          yang terjual, selalu ikut diperbarui.
        </p>
      </div>
    </>
  );
}

/** A sentence about the variant as a whole, when its state needs one. */
const variantNote = (
  variant: VariantMerge,
  display: (field: MergeField["field"], value: string) => string,
): string | undefined => {
  switch (variant.state) {
    case "kept":
      return variant.rejected
        ? "Server menolak penyimpanan karena stok varian ini berubah."
        : undefined;
    case "removed-by-me":
      return variant.fields.some((field) => field.outcome === "theirs")
        ? "Anda menghapus varian ini dari daftar; varian ini tetap diarsipkan saat disimpan. Sementara itu, di server:"
        : "Anda menghapus varian ini dari daftar; varian ini tetap diarsipkan saat disimpan.";
    case "archived-by-them":
      return "Varian ini sudah diarsipkan di server (oleh admin lain), jadi tidak dapat disimpan lagi; perubahan Anda padanya dibuang. Riwayat pesanannya tetap ada.";
    case "added-by-them": {
      const latest = variant.latest;
      const facts =
        latest === undefined
          ? ""
          : ` (${display("price", String(latest.price))}, stok ${display("stock", String(latest.stock))})`;
      return `Varian ini ditambahkan admin lain setelah Anda membuka produk${facts}. Varian ini tetap ada dan ikut disimpan apa adanya.`;
    }
    case "new":
      return undefined;
  }
};

interface ChangeGroupProps {
  title: string;
  /** A variant's label, to name its conflicts ("Stok M (KPH-M)"). */
  subject?: string;
  note?: string | undefined;
  fields: MergeField[];
  display: (field: MergeField["field"], value: string) => string;
  choices: Readonly<Record<string, MergeChoice>>;
  missing: readonly string[];
  onChoose: (key: string, choice: MergeChoice) => void;
  /** The seller removed this variant: there is no "your value". */
  removed?: boolean;
}

/** One part of the product (its info, or one variant): a table and its choices. */
function ChangeGroup({
  title,
  subject,
  note,
  fields,
  display,
  choices,
  missing,
  onChoose,
  removed = false,
}: ChangeGroupProps) {
  const headingId = useId();
  const conflicts = fields.filter((field) => field.outcome === "conflict");

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3 rounded-lg border border-border p-4"
    >
      <h3 id={headingId} className="break-words">
        {title}
      </h3>
      {note !== undefined && <p className="text-sm">{note}</p>}

      {fields.length > 0 && (
        <TableContainer aria-labelledby={headingId}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Isian</TableHead>
                <TableHead scope="col">Saat dibuka</TableHead>
                <TableHead scope="col">Perubahan Anda</TableHead>
                <TableHead scope="col">Di server sekarang</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <TableRow key={field.key}>
                  <TableHead scope="row">{FIELD_LABELS[field.field]}</TableHead>
                  <TableCell className="break-words">
                    {display(field.field, field.base)}
                  </TableCell>
                  <TableCell className="break-words">
                    {removed ? (
                      <span className="text-muted-foreground">dihapus</span>
                    ) : field.outcome === "theirs" ? (
                      <span className="text-muted-foreground">
                        tidak diubah
                      </span>
                    ) : (
                      <>
                        {display(field.field, field.mine)}
                        {field.outcome === "mine" && <Kept />}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="break-words">
                    {field.outcome === "mine" ? (
                      <span className="text-muted-foreground">
                        tidak diubah
                      </span>
                    ) : (
                      <>
                        {display(field.field, field.theirs)}
                        {field.outcome === "theirs" && !removed && <Kept />}
                      </>
                    )}
                    {field.outcome === "conflict" && (
                      <span className="block text-xs text-destructive">
                        bentrok: pilih di bawah
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {conflicts.map((field) => (
        <ConflictChoice
          key={field.key}
          field={field}
          label={
            subject === undefined
              ? FIELD_LABELS[field.field]
              : `${FIELD_LABELS[field.field]} ${subject}`
          }
          display={display}
          value={choices[field.key]}
          missing={missing.includes(field.key)}
          onChoose={onChoose}
        />
      ))}
    </section>
  );
}

/** "dipakai": which value the merged form keeps, in words. */
function Kept() {
  return (
    <span className="block text-xs font-medium text-success">dipakai</span>
  );
}

interface ConflictChoiceProps {
  field: MergeField;
  /** "Stok M (KPH-M)". */
  label: string;
  display: (field: MergeField["field"], value: string) => string;
  value: MergeChoice | undefined;
  missing: boolean;
  onChoose: (key: string, choice: MergeChoice) => void;
}

/**
 * One conflict as a radio group: the seller's value, the server's, and
 * for stock the server's plus the seller's change. A native fieldset and
 * radios: the legend names the group, the arrow keys move between them,
 * and `aria-invalid` with the message says one is still missing.
 */
function ConflictChoice({
  field,
  label,
  display,
  value,
  missing,
  onChoose,
}: ConflictChoiceProps) {
  const name = useId();
  const errorId = useId();
  const options: { choice: MergeChoice; text: string }[] = [
    {
      choice: "mine",
      text: `Milik Anda: ${display(field.field, field.mine)}`,
    },
    {
      choice: "theirs",
      text: `Dari server: ${display(field.field, field.theirs)}`,
    },
  ];
  if (field.combined !== undefined) {
    const change =
      Number(normalizeMergeValue("stock", field.mine)) - Number(field.base);
    options.push({
      choice: "combined",
      text: `Server ditambah perubahan Anda: ${display("stock", field.theirs)} ${change < 0 ? "−" : "+"} ${Math.abs(change).toLocaleString("id-ID")} = ${display("stock", field.combined)}`,
    });
  }

  return (
    <fieldset
      className="grid gap-2 rounded-md border border-input p-3"
      aria-describedby={missing ? errorId : undefined}
    >
      <legend className="px-1 text-sm font-medium">
        {label}: nilai mana yang disimpan?
      </legend>
      {options.map((option) => (
        <label key={option.choice} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={option.choice}
            data-choice-key={option.choice === "mine" ? field.key : undefined}
            checked={value === option.choice}
            aria-invalid={missing ? true : undefined}
            onChange={() => {
              onChoose(field.key, option.choice);
            }}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>{option.text}</span>
        </label>
      ))}
      {field.field === "stock" && (
        <p className="text-xs text-muted-foreground">
          Stok di server sudah memperhitungkan pembelian dan pembatalan sejak
          Anda membuka produk ini. Menyimpan angka Anda apa adanya menimpanya.
        </p>
      )}
      {missing && (
        <p id={errorId} className="text-sm text-destructive">
          Pilih salah satu.
        </p>
      )}
    </fieldset>
  );
}
