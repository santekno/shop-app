/**
 * The order pages that carry a form or are rarely opened, loaded on
 * demand like the product form (features/products/lazy.ts): the detail
 * page brings React Hook Form, Zod and the ship schema; the print view is
 * opened once per parcel. The queue, the page a seller lives on, stays in
 * the main bundle.
 */
export const loadOrderDetailPage = () =>
  import("./components/OrderDetailPage.tsx");
export const loadOrderShippingLabelPage = () =>
  import("./components/OrderShippingLabelPage.tsx");
