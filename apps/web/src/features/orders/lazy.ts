/** The orders' pages, loaded on demand: a guest never downloads them. */
export const loadPaymentPage = () => import("./components/PaymentPage.tsx");
export const loadPaymentReturnPage = () =>
  import("./components/PaymentReturnPage.tsx");
export const loadOrdersPage = () => import("./components/OrdersPage.tsx");
export const loadOrderDetailPage = () =>
  import("./components/OrderDetailPage.tsx");
