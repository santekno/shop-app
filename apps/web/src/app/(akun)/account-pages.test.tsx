// The (akun) pages (Bab 11 artikel 02–08): each one's title, the group's
// noindex, and that each page.tsx renders its own feature page through
// client-pages.tsx (a chunk loaded in the browser, "Memuat GoShop…" until
// then). The feature pages themselves are tested in features/**; here each
// is a stand-in that names itself, so a page wired to the wrong one fails.
import { render, screen } from "@testing-library/react";
import type { Metadata } from "next";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { generateMetadata as rootMetadata } from "../layout.tsx";
import * as checkout from "./checkout/page.tsx";
import { metadata as groupMetadata } from "./layout.tsx";
import * as paymentReturn from "./pembayaran/selesai/page.tsx";
import * as orders from "./pesanan/page.tsx";
import * as orderDetail from "./pesanan/[id]/page.tsx";
import * as payment from "./pesanan/[id]/pembayaran/page.tsx";

vi.mock("next/headers", () => ({ headers: () => new Headers() }));

const standIn = (name: string) => () => <h1>{name}</h1>;

vi.mock("@/features/checkout/lazy.ts", () => ({
  loadCheckoutPage: () =>
    Promise.resolve({ CheckoutPage: standIn("CheckoutPage") }),
}));
vi.mock("@/features/orders/lazy.ts", () => ({
  loadOrdersPage: () => Promise.resolve({ OrdersPage: standIn("OrdersPage") }),
  loadOrderDetailPage: () =>
    Promise.resolve({ OrderDetailPage: standIn("OrderDetailPage") }),
  loadPaymentPage: () =>
    Promise.resolve({ PaymentPage: standIn("PaymentPage") }),
  loadPaymentReturnPage: () =>
    Promise.resolve({ PaymentReturnPage: standIn("PaymentReturnPage") }),
}));

interface PageModule {
  metadata: Metadata;
  default: ComponentType;
}

const PAGES: [string, PageModule, string, string][] = [
  ["/checkout", checkout, "Checkout", "CheckoutPage"],
  ["/pesanan", orders, "Pesanan saya", "OrdersPage"],
  ["/pesanan/[id]", orderDetail, "Detail pesanan", "OrderDetailPage"],
  ["/pesanan/[id]/pembayaran", payment, "Pembayaran", "PaymentPage"],
  ["/pembayaran/selesai", paymentReturn, "Pembayaran", "PaymentReturnPage"],
];

/** The <title> Next.js makes from the root layout's template. */
const documentTitle = (title: string) => {
  const root = rootMetadata().title as { template: string };
  return root.template.replace("%s", title);
};

describe("the (akun) group", () => {
  it("keeps every personal page out of search engines (noindex, nofollow)", () => {
    expect(groupMetadata.robots).toEqual({ index: false, follow: false });
  });
});

describe.each(PAGES)("%s", (_, page, title, feature) => {
  it(`is titled "${title} — GoShop"`, () => {
    expect(page.metadata).toEqual({ title });
    expect(documentTitle(title)).toBe(`${title} — GoShop`);
  });

  it(`shows Memuat GoShop… and then renders ${feature} in the browser`, async () => {
    const Page = page.default;
    render(<Page />);

    expect(screen.getByRole("status").textContent).toBe("Memuat GoShop…");
    expect(
      await screen.findByRole("heading", { level: 1, name: feature }),
    ).toBeTruthy();
    expect(screen.queryByText("Memuat GoShop…")).toBeNull();
  });
});
