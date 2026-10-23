import { useId, useState } from "react";
import { clampQuantity, maxQuantity } from "../quantity.ts";

interface QuantityStepperProps {
  /** Units in stock for the chosen variant; the stepper never goes above it (or 99). */
  stock: number;
  label?: string;
}

/**
 * − [ 2 ] + : picks how many units to buy, from 1 up to the stock (at most
 * 99). Only for a variant in stock; the cart arrives in a later chapter, so
 * for now the number only lives here.
 */
export function QuantityStepper({
  stock,
  label = "Jumlah",
}: QuantityStepperProps) {
  // useState keeps a value between renders. Calling setQuantity stores the
  // new value and renders the component again, which reads it back.
  const [quantity, setQuantity] = useState(1);
  const labelId = useId();

  const max = maxQuantity(stock);
  // Computed while rendering, not stored: when the stock is lower than the
  // number picked, the stepper shows the stock.
  const value = clampQuantity(quantity, stock);

  return (
    <div className="stepper" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="stepper__label">
        {label}
      </span>
      <button
        type="button"
        aria-label="Kurangi jumlah"
        disabled={value <= 1}
        // The updater form, (q) => …, computes from the latest stored value
        // even when several updates are queued before the next render.
        onClick={() => {
          setQuantity((q) => clampQuantity(q - 1, stock));
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
          setQuantity((q) => clampQuantity(q + 1, stock));
        }}
      >
        +
      </button>
      <span className="muted">Maks. {max}</span>
    </div>
  );
}
