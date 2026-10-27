import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";

interface QuantityStepperProps {
  /** The quantity shown, from 1 to `max`. */
  value: number;
  /** The highest quantity on offer (the stock, at most 99), at least 1. */
  max: number;
  /** Called with the new quantity when − or + is pressed. */
  onChange: (quantity: number) => void;
  label?: string;
}

/**
 * − [ 2 ] + : picks how many units to buy, from 1 up to `max`.
 *
 * A controlled component: the number lives in the parent (ProductDetail),
 * which needs it for the subtotal, and arrives here as `value`; a press is
 * reported through onChange. In artikel 05 the stepper kept the number in
 * its own useState; lifting it up is what lets the parent read it.
 */
export function QuantityStepper({
  value,
  max,
  onChange,
  label = "Jumlah",
}: QuantityStepperProps) {
  const labelId = useId();

  return (
    <div
      className="flex items-center gap-2"
      role="group"
      aria-labelledby={labelId}
    >
      <span id={labelId} className="mr-1 font-semibold">
        {label}
      </span>
      <Button
        variant="outline"
        size="icon"
        aria-label="Kurangi jumlah"
        disabled={value <= 1}
        onClick={() => {
          onChange(value - 1);
        }}
      >
        <Minus aria-hidden="true" />
      </Button>
      <output
        className="stepper__value min-w-[2ch] text-center tabular-nums"
        aria-live="polite"
      >
        {value}
      </output>
      <Button
        variant="outline"
        size="icon"
        aria-label="Tambah jumlah"
        disabled={value >= max}
        onClick={() => {
          onChange(value + 1);
        }}
      >
        <Plus aria-hidden="true" />
      </Button>
      <span className="text-sm text-muted-foreground">Maks. {max}</span>
    </div>
  );
}
