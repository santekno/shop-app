/** The orders' pages, loaded on demand: a guest never downloads them. */
export const loadPaymentPage = () => import("./components/PaymentPage.tsx");
export const loadPaymentReturnPage = () =>
  import("./components/PaymentReturnPage.tsx");
