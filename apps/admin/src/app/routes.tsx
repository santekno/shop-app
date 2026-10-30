import type { RouteObject } from "react-router";
import { RequireStaff } from "@/features/auth/components/RequireStaff.tsx";
import { loadLoginPage } from "@/features/auth/lazy.ts";
import { OverviewPage } from "@/features/dashboard/components/OverviewPage.tsx";
import { OrdersPage } from "@/features/orders/components/OrdersPage.tsx";
import {
  loadOrderDetailPage,
  loadOrderShippingLabelPage,
} from "@/features/orders/lazy.ts";
import { ProductsPage } from "@/features/products/components/ProductsPage.tsx";
import {
  loadProductCreatePage,
  loadProductEditPage,
} from "@/features/products/lazy.ts";
import { ReportsPage } from "@/features/reports/components/ReportsPage.tsx";
import { AppLoading } from "./AppLoading.tsx";
import { AppRoot } from "./AppRoot.tsx";
import type { RouteHandle } from "./route-crumbs.ts";
import { DashboardLayout } from "./DashboardLayout.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { RootErrorPage, RouteErrorPage } from "./RouteErrorPage.tsx";

/** A route's handle, typed (React Router keeps it as `unknown`). */
const crumb = (label: string): RouteHandle => ({ crumb: label });

/**
 * Every page of the dashboard, as data:
 *
 *   /masuk        AppRoot > LoginPage
 *   /             AppRoot > RequireStaff > DashboardLayout > OverviewPage
 *   /produk       AppRoot > RequireStaff > DashboardLayout > ProductsPage
 *   /produk/baru  AppRoot > RequireStaff > DashboardLayout > ProductCreatePage
 *   /produk/:id   AppRoot > RequireStaff > DashboardLayout > ProductEditPage
 *   /pesanan      AppRoot > RequireStaff > DashboardLayout > OrdersPage
 *   /pesanan/:id  AppRoot > RequireStaff > DashboardLayout > OrderDetailPage
 *   /pesanan/:id/resi  AppRoot > RequireStaff > OrderShippingLabelPage
 *   /laporan      AppRoot > RequireStaff > DashboardLayout > ReportsPage
 *   other         AppRoot > RequireStaff > DashboardLayout > NotFoundPage
 *
 * Everything but /masuk sits under RequireStaff, a layout route without a
 * path: one place decides who may see the dashboard (a seller or an
 * admin), instead of a check in every page.
 *
 * `handle.crumb` names a page in the breadcrumb (Breadcrumbs.tsx reads it
 * with useMatches): the layout's "Dasbor", then the page's own name. The
 * product pages nest under "produk", whose crumb is the link back to the
 * table: "Dasbor › Produk › Ubah produk".
 *
 * Code splitting: the login page and the two product-form pages are lazy
 * (features/auth/lazy.ts, features/products/lazy.ts): they carry React
 * Hook Form and Zod. Every other page is in the main bundle; Recharts
 * (artikel 07) will be the next split.
 *
 * The pages sit under a pathless route with an ErrorBoundary, so an error
 * replaces the page but keeps the sidebar; the root has one too, for an
 * error in a layout or the login page.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    Component: AppRoot,
    ErrorBoundary: RootErrorPage,
    // A visit that starts on /masuk waits for the login page's code.
    HydrateFallback: AppLoading,
    children: [
      {
        path: "masuk",
        // lazy: the login form's code (React Hook Form, Zod) is a separate
        // file, downloaded the first time /masuk is visited.
        lazy: async () => ({
          Component: (await loadLoginPage()).LoginPage,
        }),
      },
      {
        Component: RequireStaff,
        children: [
          {
            // The printable label: staff only, but without the dashboard
            // around it, so the page is the paper (artikel 06).
            path: "pesanan/:orderId/resi",
            lazy: async () => ({
              Component: (await loadOrderShippingLabelPage())
                .OrderShippingLabelPage,
            }),
          },
          {
            Component: DashboardLayout,
            handle: crumb("Dasbor"),
            children: [
              {
                ErrorBoundary: RouteErrorPage,
                children: [
                  {
                    index: true,
                    Component: OverviewPage,
                    handle: crumb("Ringkasan"),
                  },
                  {
                    path: "produk",
                    handle: crumb("Produk"),
                    children: [
                      { index: true, Component: ProductsPage },
                      {
                        path: "baru",
                        lazy: async () => ({
                          Component: (await loadProductCreatePage())
                            .ProductCreatePage,
                        }),
                        handle: crumb("Tambah produk"),
                      },
                      {
                        path: ":productId",
                        lazy: async () => ({
                          Component: (await loadProductEditPage())
                            .ProductEditPage,
                        }),
                        handle: crumb("Ubah produk"),
                      },
                    ],
                  },
                  {
                    path: "pesanan",
                    handle: crumb("Pesanan"),
                    children: [
                      { index: true, Component: OrdersPage },
                      {
                        path: ":orderId",
                        lazy: async () => ({
                          Component: (await loadOrderDetailPage())
                            .OrderDetailPage,
                        }),
                        handle: crumb("Detail pesanan"),
                      },
                    ],
                  },
                  {
                    path: "laporan",
                    Component: ReportsPage,
                    handle: crumb("Laporan"),
                  },
                  {
                    path: "*",
                    Component: NotFoundPage,
                    handle: crumb("Tidak ditemukan"),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
