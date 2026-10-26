/** The most units of one variant a buyer can pick at once. */
export const MAX_QUANTITY = 99;

/** The highest quantity on offer: the stock, capped at 99; 0 when sold out. */
export const maxQuantity = (stock: number): number =>
  Math.max(0, Math.min(Math.floor(stock), MAX_QUANTITY));

/**
 * Keeps a quantity between 1 and maxQuantity(stock), so a stock that drops
 * below what was picked lowers the quantity instead of overselling. A sold
 * out variant gives 0.
 */
export const clampQuantity = (quantity: number, stock: number): number => {
  const max = maxQuantity(stock);
  if (max === 0) return 0;
  return Math.min(Math.max(1, Math.floor(quantity)), max);
};
