import type { RouteObject } from "react-router";
import { RequireStaff } from "@/features/auth/components/RequireStaff.tsx";
import { loadLoginPage } from "@/features/auth/lazy.ts";
import { OverviewPage } from "@/features/dashboard/components/OverviewPage.tsx";
import { OrdersPage } from "@/features/orders/components/OrdersPage.tsx";
import { ProductsPage } from "@/features/products/components/ProductsPage.tsx";
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
 *   /masuk     AppRoot > LoginPage
 *   /          AppRoot > RequireStaff > DashboardLayout > OverviewPage
 *   /produk    AppRoot > RequireStaff > DashboardLayout > ProductsPage
 *   /pesanan   AppRoot > RequireStaff > DashboardLayout > OrdersPage
 *   /laporan   AppRoot > RequireStaff > DashboardLayout > ReportsPage
 *   other      AppRoot > RequireStaff > DashboardLayout > NotFoundPage
 *
 * Everything but /masuk sits under RequireStaff, a layout route without a
 * path: one place decides who may see the dashboard (a seller or an
 * admin), instead of a check in every page.
 *
 * `handle.crumb` names a page in the breadcrumb (Breadcrumbs.tsx reads it
 * with useMatches): the layout's "Dasbor", then the page's own name.
 *
 * Code splitting: only the login page is lazy (lazy.ts). Every other page
 * is in the main bundle; Recharts (artikel 07) will be the next split.
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
                    Component: ProductsPage,
                    handle: crumb("Produk"),
                  },
                  {
                    path: "pesanan",
                    Component: OrdersPage,
                    handle: crumb("Pesanan"),
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
