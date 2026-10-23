import { useId } from "react";

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
    <div className="stepper" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="stepper__label">
        {label}
      </span>
      <button
        type="button"
        aria-label="Kurangi jumlah"
        disabled={value <= 1}
        onClick={() => {
          onChange(value - 1);
        }}
      >
        −
      </button>
      <output className="stepper__value" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        aria-label="Tambah jumlah"
        disabled={value >= max}
        onClick={() => {
          onChange(value + 1);
        }}
      >
        +
      </button>
      <span className="muted">Maks. {max}</span>
    </div>
  );
}
