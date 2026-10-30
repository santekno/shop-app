/**
 * The report page, loaded on demand, like the product forms
 * (features/products/lazy.ts): Recharts and the charts are downloaded the
 * first time someone opens "Laporan", not by everyone who opens the
 * dashboard to work through the orders.
 */
export const loadReportsPage = () => import("./components/ReportsPage.tsx");
