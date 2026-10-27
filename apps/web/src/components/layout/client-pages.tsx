"use client";

import dynamic from "next/dynamic";
import { loadAccountPage } from "@/features/account/lazy.ts";
import { loadLoginPage, loadRegisterPage } from "@/features/auth/lazy.ts";
import { loadCartPage } from "@/features/cart/lazy.ts";
import { loadCheckoutPage } from "@/features/checkout/lazy.ts";
import {
  loadOrderDetailPage,
  loadOrdersPage,
  loadPaymentPage,
  loadPaymentReturnPage,
} from "@/features/orders/lazy.ts";
import { AppLoading } from "./AppLoading.tsx";

/**
 * The pages that render only in the browser (Bab 11 artikel 08).
 *
 * Every one of them depends on what only the browser has: the session
 * (the access token in memory, restored from the refresh cookie, which is
 * sent to the API, never to this server: Bab 10), the guest cart's token
 * in localStorage, or a payment remembered in sessionStorage. Rendered on
 * the server they could only say "Memeriksa sesi Anda…", and search
 * engines must not index them anyway (app/(akun)/layout.tsx: noindex).
 *
 * `dynamic(…, { ssr: false })` is Next.js' lazy(): the page's code is a
 * chunk of its own, downloaded when the page is opened (the job of Bab
 * 9–10's lazy routes, with the same load functions in each feature's
 * lazy.ts), and the server sends only `loading` in its place. It may only
 * be called in a client component, hence this file: the page.tsx files
 * stay server components that set the title and robots, and render these.
 * (The options must be written out in each call: Next.js reads them when
 * it compiles the file.)
 */

export const CartPage = dynamic(async () => (await loadCartPage()).CartPage, {
  ssr: false,
  loading: () => <AppLoading />,
});
export const LoginPage = dynamic(
  async () => (await loadLoginPage()).LoginPage,
  { ssr: false, loading: () => <AppLoading /> },
);
export const RegisterPage = dynamic(
  async () => (await loadRegisterPage()).RegisterPage,
  { ssr: false, loading: () => <AppLoading /> },
);
export const AccountPage = dynamic(
  async () => (await loadAccountPage()).AccountPage,
  { ssr: false, loading: () => <AppLoading /> },
);
export const CheckoutPage = dynamic(
  async () => (await loadCheckoutPage()).CheckoutPage,
  { ssr: false, loading: () => <AppLoading /> },
);
export const OrdersPage = dynamic(
  async () => (await loadOrdersPage()).OrdersPage,
  { ssr: false, loading: () => <AppLoading /> },
);
export const OrderDetailPage = dynamic(
  async () => (await loadOrderDetailPage()).OrderDetailPage,
  { ssr: false, loading: () => <AppLoading /> },
);
export const PaymentPage = dynamic(
  async () => (await loadPaymentPage()).PaymentPage,
  { ssr: false, loading: () => <AppLoading /> },
);
export const PaymentReturnPage = dynamic(
  async () => (await loadPaymentReturnPage()).PaymentReturnPage,
  { ssr: false, loading: () => <AppLoading /> },
);
