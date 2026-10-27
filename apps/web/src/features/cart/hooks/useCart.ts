import { useQuery } from "@tanstack/react-query";
import type { Cart } from "@goshop/shared";
import { cartQuery } from "../api/queries.ts";
import { useCartToken } from "../cart-token-context.ts";

/**
 * The buyer's guest cart, from the cache (GET /v1/cart). `select`, when
 * given, picks a part of it; the component then renders again only when
 * that part changes. Pass a function defined once (not an inline arrow),
 * so TanStack Query can skip running it when the cart has not changed.
 */
export const useCart = <T = Cart>(select?: (cart: Cart) => T) => {
  const { cartToken, setCartToken } = useCartToken();
  // A token the API no longer knows is forgotten (see cartQuery).
  const forgetCart = () => {
    setCartToken(null);
  };
  return useQuery({ ...cartQuery(cartToken, forgetCart), select });
};
