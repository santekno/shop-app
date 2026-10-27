/**
 * The cart page's code, loaded on demand (Bab 11 artikel 08). It renders
 * only in the browser, where the guest cart's token and the session are
 * (components/layout/client-pages.tsx).
 */
export const loadCartPage = () => import("./components/CartPage.tsx");
