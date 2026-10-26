import type { ReactNode } from "react";

/**
 * A bridge for the Bab 9 unit tests only; no application code renders it.
 * The guest cart token now lives in the Zustand store (cart-store.ts),
 * which needs no provider, so this renders its children and nothing else.
 * Delete it with cart-token-context.ts when no test imports either.
 */
export function CartTokenProvider({ children }: { children: ReactNode }) {
  return children;
}
