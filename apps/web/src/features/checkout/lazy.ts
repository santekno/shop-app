/** The checkout's code, loaded on demand: a guest never downloads it. */
export const loadCheckoutPage = () => import("./components/CheckoutPage.tsx");
