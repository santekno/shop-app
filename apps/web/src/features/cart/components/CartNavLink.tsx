import { NavLink } from "@/components/navigation/NavLink.tsx";
import type { Cart } from "@goshop/shared";
import { useCart } from "../hooks/useCart.ts";
import { Badge } from "@/components/ui/Badge.tsx";

const selectItemCount = (cart: Cart) => cart.item_count;

/** The header's link to the cart, with the number of units in it. */
export function CartNavLink() {
  // Only the count: this link renders again when the count changes, not
  // when, say, a price in the cart does.
  const { data: count = 0 } = useCart(selectItemCount);
  return (
    <NavLink href="/keranjang">
      Keranjang
      {/* {" "}: a real space, not only the badge's CSS margin; without it
          some engines read "Keranjang3 barang" as the link's name. */}
      {count > 0 && (
        <>
          {" "}
          {/* cart-count: a hook for the tests; the badge's default look
              (bg-primary, text-primary-foreground) is the token's. */}
          <Badge className="cart-count ml-1.5 min-w-6">
            {/* Read as "Keranjang 3 barang"; the eye sees a badge. The
                space is a text node of its own, not inside the hidden
                span, so jsdom and every browser keep it in the name. */}
            {count} <span className="sr-only">barang</span>
          </Badge>
        </>
      )}
    </NavLink>
  );
}
