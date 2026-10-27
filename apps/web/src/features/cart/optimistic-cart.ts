import type { Cart, CartItemAdd, Money } from "@goshop/shared";

/**
 * The cart as it will look once `item` is in it, computed before the
 * server answers: the optimistic guess.
 *
 * It changes what the buyer sees right away: the number of units (the
 * header's count), the subtotal, and the quantity of a line that already
 * holds this variant. A variant that is not in the cart yet gets no line
 * here: a line needs data only the server has (its weight, its product
 * id), and no page that shows lines is on screen while adding. The
 * server's answer replaces the guess a moment later, line included.
 *
 * A pure function (no React, no cache) so it is easy to read and test.
 */
export const withAddedItem = (
  cart: Cart,
  item: CartItemAdd,
  unitPrice: Money,
): Cart => ({
  ...cart,
  item_count: cart.item_count + item.quantity,
  subtotal: {
    ...cart.subtotal,
    amount: cart.subtotal.amount + unitPrice.amount * item.quantity,
  },
  lines: cart.lines.map((line) => {
    if (line.variant_id !== item.variant_id) return line;
    const quantity = line.quantity + item.quantity;
    return {
      ...line,
      quantity,
      line_total: {
        ...line.line_total,
        amount: line.unit_price.amount * quantity,
      },
    };
  }),
});
