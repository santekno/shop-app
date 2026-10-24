import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CartTokenContext } from "./cart-token-context.ts";

/**
 * Holds the guest cart token for everything below it: the product page
 * (adding), the header (the count) and the cart page. Context, because
 * those components are far apart in the tree and passing the token
 * through every layer as props would touch components that never use it.
 */
export function CartTokenProvider({ children }: { children: ReactNode }) {
  const [cartToken, setCartToken] = useState<string | null>(null);
  // One object per token, so components reading the context render again
  // only when the token changes, not whenever this provider renders.
  const value = useMemo(() => ({ cartToken, setCartToken }), [cartToken]);
  return <CartTokenContext value={value}>{children}</CartTokenContext>;
}
