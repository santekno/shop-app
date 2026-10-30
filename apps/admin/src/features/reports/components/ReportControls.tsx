import { useId, useRef, useState } from "react";
import type { ReactNode, SubmitEvent } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Label } from "@/components/ui/Label.tsx";
import { NativeSelect } from "@/components/ui/NativeSelect.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import {
  GROUP_OPTIONS,
  hasRangeErrors,
  MAX_RANGE_DAYS,
  PRESET_DAYS,
  rangeErrors,
} from "../report-params.ts";
import type { RangeErrors, ReportParams } from "../report-params.ts";

interface ReportControlsProps {
  params: ReportParams;
  /** The two dates the current range covers (a preset, resolved). */
  resolved: { from: string; to: string };
  onChange: (change: Partial<ReportParams>) => void;
}

/** The radio value of the "own dates" choice. */
const CUSTOM = "kustom";

/**
 * The report's controls, in one row above the charts: the range (7, 30
 * or 90 days, or two dates) and the grouping.
 *
 * The range is a group of radio buttons drawn as one segmented control:
 * a radio group is what "exactly one of these" is (arrow keys move
 * between the options, a screen reader says "2 of 4"), where a row of
 * buttons would need aria-pressed and a key handler of ours.
 *
 * "Pilih tanggal" only opens the date form; the report changes when the
 * dates are applied, so a range is never fetched half-chosen.
 */
export function ReportControls({
  params,
  resolved,
  onChange,
}: ReportControlsProps) {
  const groupId = useId();
  const name = useId();
  // "Pilih tanggal" chosen, dates not applied yet. Forgotten whenever the
  // state from the URL changes (Back, a preset, applied dates).
  const [choosingCustom, setChoosingCustom] = useState(false);
  const [seen, setSeen] = useState(params);
  if (params !== seen) {
    setSeen(params);
    setChoosingCustom(false);
  }
  const showCustom = params.range.kind === "custom" || choosingCustom;
  const checked = showCustom
    ? CUSTOM
    : String(params.range.kind === "preset" ? params.range.days : "");

  return (
    <div className="mb-6 grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm leading-none font-medium">
            Rentang
          </legend>
          <div className="inline-flex flex-wrap rounded-md border border-input bg-background p-0.5">
            {PRESET_DAYS.map((days) => (
              <Segment
                key={days}
                name={name}
                value={String(days)}
                checked={checked === String(days)}
                onSelect={() => {
                  setChoosingCustom(false);
                  onChange({ range: { kind: "preset", days } });
                }}
              >
                {days} hari
              </Segment>
            ))}
            <Segment
              name={name}
              value={CUSTOM}
              checked={checked === CUSTOM}
              onSelect={() => {
                setChoosingCustom(true);
              }}
            >
              Pilih tanggal
            </Segment>
          </div>
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor={groupId}>Kelompokkan</Label>
          <NativeSelect
            id={groupId}
            className="w-auto"
            value={params.group}
            onChange={(event) => {
              const group = GROUP_OPTIONS.find(
                (option) => option.value === event.target.value,
              )?.value;
              if (group !== undefined) onChange({ group });
            }}
          >
            {GROUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {showCustom && (
        // A new key when the range changes: the form starts again from
        // the dates on screen instead of keeping stale ones.
        <CustomRangeForm
          key={`${resolved.from}/${resolved.to}`}
          initial={resolved}
          onApply={(from, to) => {
            onChange({ range: { kind: "custom", from, to } });
          }}
        />
      )}
    </div>
  );
}

/** One option of the segmented control: a real radio, visually hidden. */
function Segment({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    // The label is the visible segment. The radio inside it keeps the
    // keyboard and the screen reader; has-checked and has-focus-visible
    // style the label from the radio's state, so the look is written
    // against the same fact a screen reader announces.
    <label className="inline-flex h-9 cursor-pointer items-center rounded-sm px-3 text-sm font-medium whitespace-nowrap text-foreground hover:bg-accent has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {children}
    </label>
  );
}

interface CustomRangeFormProps {
  initial: { from: string; to: string };
  onApply: (from: string, to: string) => void;
}

/**
 * Two dates and "Terapkan", checked with the API's own rules
 * (rangeErrors) before anything is fetched. Validate late, re-check
 * early, like the product form: nothing is said while the seller picks,
 * the check runs on "Terapkan", and once a message is on screen it is
 * checked again on every change, so it goes away as soon as the dates
 * are right.
 */
function CustomRangeForm({ initial, onApply }: CustomRangeFormProps) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [errors, setErrors] = useState<RangeErrors | null>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const recheck = (nextFrom: string, nextTo: string) => {
    if (errors !== null) setErrors(rangeErrors(nextFrom, nextTo));
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = rangeErrors(from, to);
    if (hasRangeErrors(found)) {
      setErrors(found);
      // The first field that needs a change gets the focus, so its
      // message is read at once.
      (found.from !== undefined ? fromRef : toRef).current?.focus();
      return;
    }
    setErrors(null);
    onApply(from, to);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Rentang tanggal"
      className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-start"
    >
      <p className="text-sm text-muted-foreground sm:col-span-3">
        Tanggal menurut WIB, keduanya ikut dihitung. Paling panjang{" "}
        {MAX_RANGE_DAYS} hari.
      </p>
      <TextField
        ref={fromRef}
        label="Dari"
        type="date"
        value={from}
        error={errors?.from}
        onChange={(event) => {
          setFrom(event.target.value);
          recheck(event.target.value, to);
        }}
      />
      <TextField
        ref={toRef}
        label="Sampai"
        type="date"
        value={to}
        error={errors?.to}
        onChange={(event) => {
          setTo(event.target.value);
          recheck(from, event.target.value);
        }}
      />
      <Button type="submit" className="sm:mt-6">
        Terapkan
      </Button>
    </form>
  );
}
