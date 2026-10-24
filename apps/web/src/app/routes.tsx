import type { RouteObject } from "react-router";
import { LoginPage } from "@/features/auth/components/LoginPage.tsx";
import { RegisterPage } from "@/features/auth/components/RegisterPage.tsx";
import { AuthLayout } from "@/features/auth/components/AuthLayout.tsx";
import { CartPage } from "@/features/cart/components/CartPage.tsx";
import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";
import { ProductDetailPage } from "@/features/product/components/ProductDetailPage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { RootLayout } from "./RootLayout.tsx";

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
 *   anything else    RootLayout > NotFoundPage
 *
 * The routes are a plain array, separate from the router, so a test can
 * mount the same tree in a memory router (createMemoryRouter(routes)).
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    Component: RootLayout,
    children: [
      // `index`: what the parent shows at its own URL, "/".
      { index: true, Component: CatalogPage },
      // `:slug` is a URL parameter: useParams() reads it as a string.
      { path: "produk/:slug", Component: ProductDetailPage },
      { path: "keranjang", Component: CartPage },
      // A layout route without a path: it adds no URL segment, only a
      // shared frame around both auth pages.
      {
        Component: AuthLayout,
        children: [
          { path: "masuk", Component: LoginPage },
          { path: "daftar", Component: RegisterPage },
        ],
      },
      // `*` matches whatever no other route did: the 404 page, still
      // inside the layout, so the header stays.
      { path: "*", Component: NotFoundPage },
    ],
  },
];
