import type { RouteObject } from "react-router";
import { loadAccountPage } from "@/features/account/lazy.ts";
import { AuthLayout } from "@/features/auth/components/AuthLayout.tsx";
import { RequireAuth } from "@/features/auth/components/RequireAuth.tsx";
import { loadLoginPage, loadRegisterPage } from "@/features/auth/lazy.ts";
import { CartPage } from "@/features/cart/components/CartPage.tsx";
import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";
import { loadCheckoutPage } from "@/features/checkout/lazy.ts";
import {
  loadOrderDetailPage,
  loadOrdersPage,
  loadPaymentPage,
  loadPaymentReturnPage,
} from "@/features/orders/lazy.ts";
import { loadProductPage } from "@/features/product/lazy.ts";
import { PRODUCT_ROUTE } from "@/features/product/paths.ts";
import { AppLoading } from "./AppLoading.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { RootLayout } from "./RootLayout.tsx";
import { RouteErrorPage } from "./RouteErrorPage.tsx";

/**
 * Every page of the storefront, as data. A route object is a URL pattern
 * plus the component that renders it; `children` nest inside their
 * parent, which shows them through <Outlet />.
 *
 *   /                RootLayout > CatalogPage
 *   /produk/:slug    RootLayout > ProductDetailPage
 *   /keranjang       RootLayout > CartPage
 *   /masuk           RootLayout > AuthLayout > LoginPage
 *   /daftar          RootLayout > AuthLayout > RegisterPage
 *   /akun            RootLayout > RequireAuth > AccountPage (needs a login)
 *   /checkout        RootLayout > RequireAuth > CheckoutPage (Bab 11)
 *   /pesanan         RootLayout > RequireAuth > OrdersPage
 *   /pesanan/:id     RootLayout > RequireAuth > OrderDetailPage
 *   /pesanan/:id/pembayaran
 *                    RootLayout > RequireAuth > PaymentPage
 *   /pembayaran/selesai
 *                    RootLayout > RequireAuth > PaymentReturnPage (Midtrans' return)
 *   anything else    RootLayout > NotFoundPage
 *
 * An error thrown while a page renders is caught by the nearest
 * `ErrorBoundary` above it (React Router calls it errorElement when it is
 * an element). The pages sit under a pathless route that has one, so an
 * error replaces the page but keeps the header; the root route has one
 * too, for an error in RootLayout itself.
 *
 * Code splitting: the catalog, the cart and the layouts are in the main
 * bundle, because most visits start on the catalog. The product page and
 * the auth pages are `lazy`: their code is a separate file, downloaded
 * the first time the route is visited. The router waits for it before it
 * shows the new page (RootLayout shows a progress bar meanwhile), and a
 * download that fails reaches the ErrorBoundary like any other error.
 *
 * The routes are a plain array, separate from the router, so a test can
 * mount the same tree in a memory router (createMemoryRouter(routes)).
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    Component: RootLayout,
    ErrorBoundary: RouteErrorPage,
    // The first page of a visit may be a lazy one: shown until its code
    // has loaded.
    HydrateFallback: AppLoading,
    children: [
      {
        // No path: it only puts an error boundary around every page,
        // inside the layout.
        ErrorBoundary: RouteErrorPage,
        children: [
          // `index`: what the parent shows at its own URL, "/".
          { index: true, Component: CatalogPage },
          // "/produk/:slug": `:slug` is a URL parameter, read with useParams().
          // A child's path may be written in full when it starts with the
          // parent's ("/"); the constant is shared with productPath and
          // useRouteFocus, so the pattern is written once.
          {
            path: PRODUCT_ROUTE,
            // lazy returns the route's remaining properties; here only
            // its Component, taken from the module once it has loaded.
            lazy: async () => ({
              Component: (await loadProductPage()).ProductDetailPage,
            }),
          },
          { path: "keranjang", Component: CartPage },
          // A layout route without a path: it adds no URL segment, only a
          // shared frame around both auth pages.
          {
            Component: AuthLayout,
            children: [
              {
                path: "masuk",
                lazy: async () => ({
                  Component: (await loadLoginPage()).LoginPage,
                }),
              },
              {
                path: "daftar",
                lazy: async () => ({
                  Component: (await loadRegisterPage()).RegisterPage,
                }),
              },
            ],
          },
          // Pages that need a login: a layout route without a path, like
          // AuthLayout, whose component decides whether its children may
          // render (RequireAuth: wait, redirect to /masuk, or render).
          {
            Component: RequireAuth,
            children: [
              {
                path: "akun",
                lazy: async () => ({
                  Component: (await loadAccountPage()).AccountPage,
                }),
              },
              {
                path: "checkout",
                lazy: async () => ({
                  Component: (await loadCheckoutPage()).CheckoutPage,
                }),
              },
              {
                path: "pesanan",
                lazy: async () => ({
                  Component: (await loadOrdersPage()).OrdersPage,
                }),
              },
              {
                path: "pesanan/:id",
                lazy: async () => ({
                  Component: (await loadOrderDetailPage()).OrderDetailPage,
                }),
              },
              {
                path: "pesanan/:id/pembayaran",
                lazy: async () => ({
                  Component: (await loadPaymentPage()).PaymentPage,
                }),
              },
              {
                path: "pembayaran/selesai",
                lazy: async () => ({
                  Component: (await loadPaymentReturnPage()).PaymentReturnPage,
                }),
              },
            ],
          },
          // `*` matches whatever no other route did: the 404 page, still
          // inside the layout, so the header stays.
          { path: "*", Component: NotFoundPage },
        ],
      },
    ],
  },
];
