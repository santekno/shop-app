import { useQuery } from "@tanstack/react-query";
import type { Cart } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { cartQuery, userCartQuery } from "../api/queries.ts";
import { selectCartToken, useCartStore } from "../cart-store.ts";

/**
 * The buyer's cart, from the cache (GET /v1/cart): the logged-in user's
 * cart after a login, the guest cart before. `select`, when given, picks a
 * part of it; the component then renders again only when that part
 * changes. Pass a function defined once (not an inline arrow), so TanStack
 * Query can skip running it when the cart has not changed.
 *
 * While the session is still being restored at start-up nobody knows whose
 * cart to show, so nothing is fetched until it is known.
 */
export const useCart = <T = Cart>(select?: (cart: Cart) => T) => {
  const { status, session, authApi } = useSession();
  // Only the token: a component using the cart renders again when the
  // token changes, not when the store's other fields do.
  const cartToken = useCartStore(selectCartToken);
  // Actions never change, so reading one causes no extra render. A token
  // the API no longer knows is forgotten (see cartQuery).
  const forgetCart = useCartStore((state) => state.forgetCart);
  const options =
    status === "authenticated"
      ? userCartQuery(authApi, session.user.id)
      : cartQuery(cartToken, forgetCart);
  return useQuery({ ...options, select, enabled: status !== "restoring" });
};
