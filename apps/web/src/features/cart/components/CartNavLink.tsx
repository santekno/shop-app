import { NavLink } from "react-router";
import type { Cart } from "@goshop/shared";
import { useCart } from "../hooks/useCart.ts";

const selectItemCount = (cart: Cart) => cart.item_count;

/** The header's link to the cart, with the number of units in it. */
export function CartNavLink() {
  // Only the count: this link renders again when the count changes, not
  // when, say, a price in the cart does.
  const { data: count = 0 } = useCart(selectItemCount);
  return (
    <NavLink to="/keranjang">
      Keranjang
      {/* {" "}: a real space, not only the badge's CSS margin; without it
          some engines read "Keranjang3 barang" as the link's name. */}
      {count > 0 && (
        <>
          {" "}
          <span className="cart-count">
            {/* Read as "Keranjang 3 barang"; the eye sees a badge. The
                space is a text node of its own, not inside the hidden
                span, so jsdom and every browser keep it in the name. */}
            {count} <span className="visually-hidden">barang</span>
          </span>
        </>
      )}
    </NavLink>
  );
}
