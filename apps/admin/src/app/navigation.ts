import {
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** One link of the sidebar. */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** What the section is for, in one sentence (the overview's cards). */
  description: string;
  /**
   * Active on this exact path only. "/" needs it: every path starts with
   * "/", so without it "Ringkasan" would be marked on every page.
   */
  end?: boolean;
}

/**
 * The sidebar, as data: the order on screen, the path, the name and what
 * the section is for (the overview page lists them too). The
 * labels match the routes' breadcrumbs (routes.tsx). Every item is for
 * both staff roles: no section is admin-only (artikel 08: the one
 * admin-only action, cancelling an order, is a button, not a page). An
 * admin-only page would filter its item with the same `can` as its route.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/",
    label: "Ringkasan",
    icon: LayoutDashboard,
    description: "Gambaran singkat toko Anda.",
    end: true,
  },
  {
    to: "/produk",
    label: "Produk",
    icon: Package,
    description: "Tambah, ubah dan arsipkan produk, foto, varian dan stok.",
  },
  {
    to: "/pesanan",
    label: "Pesanan",
    icon: ClipboardList,
    description: "Proses, kirim dan selesaikan pesanan pembeli.",
  },
  {
    to: "/laporan",
    label: "Laporan",
    icon: ChartColumn,
    description: "Grafik penjualan dan produk terlaris.",
  },
];
