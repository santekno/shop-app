import { Check } from "lucide-react";
import { cn } from "@/lib/utils.ts";

interface StepIndicatorProps {
  /** The steps' titles, in order. */
  steps: readonly { title: string }[];
  /** The index of the step on screen. */
  current: number;
  /** A step was chosen; the form decides whether it may go there. */
  onSelect: (index: number) => void;
}

/**
 * "1 Info dasar › 2 Varian & harga › 3 Tinjau" above the form.
 *
 * An ordered list in a named <nav>, because it is both a map (where am I,
 * how many steps) and a way to move. Each step is a button; the current
 * one carries aria-current="step", which a screen reader reads as "current
 * step" and the style is written against, so the eye and the ear get the
 * same fact. A finished step shows a check mark, with "selesai" for a
 * screen reader. Choosing a later step validates the steps on the way
 * (ProductForm's goTo), so the indicator is never a way around them.
 */
export function StepIndicator({
  steps,
  current,
  onSelect,
}: StepIndicatorProps) {
  return (
    <nav aria-label="Langkah formulir produk" className="mb-6">
      <ol className="flex flex-wrap gap-2">
        {steps.map((step, index) => {
          const done = index < current;
          return (
            <li key={step.title}>
              <button
                type="button"
                aria-current={index === current ? "step" : undefined}
                onClick={() => {
                  onSelect(index);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  "aria-[current=step]:border-primary aria-[current=step]:bg-primary aria-[current=step]:text-primary-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-5 items-center justify-center rounded-full border border-current text-xs"
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                <span>
                  <span className="sr-only">Langkah {index + 1}: </span>
                  {step.title}
                  {done && <span className="sr-only"> (selesai)</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
