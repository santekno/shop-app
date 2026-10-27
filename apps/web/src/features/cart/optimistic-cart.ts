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

/**
 * The cart as it will look once the line of `variantId` holds `quantity`
 * units: the guess a quantity change shows at the click (artikel Bab 11
 * 01). Like withAddedItem it moves the count, the line's total and the
 * cart's subtotal, which is only a hint on the cart page; what an order
 * charges is computed by the API at checkout, never here. A variant that
 * is not in the cart leaves the cart as it is.
 */
export const withLineQuantity = (
  cart: Cart,
  variantId: string,
  quantity: number,
): Cart => {
  const line = cart.lines.find((each) => each.variant_id === variantId);
  if (line === undefined) return cart;
  const change = quantity - line.quantity;
  return {
    ...cart,
    item_count: cart.item_count + change,
    subtotal: {
      ...cart.subtotal,
      amount: cart.subtotal.amount + line.unit_price.amount * change,
    },
    lines: cart.lines.map((each) =>
      each.variant_id === variantId
        ? {
            ...each,
            quantity,
            line_total: {
              ...each.line_total,
              amount: each.unit_price.amount * quantity,
            },
          }
        : each,
    ),
  };
};
