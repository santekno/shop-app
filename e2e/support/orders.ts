// Buyers, carts, orders and payments for the Bab 11 checkout, payment and
// order history specs, set up through the real API with plain fetch (the
// contract, not the storefront's client), and through the stack's
// Postgres only where the API has no endpoint: a verified email, and a
// product's stock put back afterwards.
//
// Payments go through the stack's own test gateway (APP_PAYMENT_PROVIDER=
// fake, docker-compose.yml's default): POST /v1/orders/{id}/pay answers
// provider "fake", and `api fake-pay` inside the api container does what
// Midtrans does when a buyer pays: it sends the API a signed notification,
// which the API checks and applies like Midtrans' own.
import { expect } from "@playwright/test";
import { registerBuyer } from "./accounts.ts";
import type { Account } from "./accounts.ts";
import { API_URL, compose, psql } from "./stack.ts";

/** Registers a new buyer and marks the email verified (checkout needs it). */
export const registerVerifiedBuyer = async (
  label: string,
): Promise<Account> => {
  const account = await registerBuyer(label);
  psql(
    `UPDATE users SET email_verified_at = now() WHERE email = '${account.email}'`,
  );
  return account;
};

/**
 * Registers a new account and makes it an admin, as `make seed-admin`
 * does, for the specs that write the catalog (a product with a photo).
 */
export const registerAdmin = async (label: string): Promise<Account> => {
  const account = await registerBuyer(label);
  psql(
    `UPDATE users SET role = 'admin', email_verified_at = now() WHERE email = '${account.email}'`,
  );
  return account;
};

/** POST /v1/auth/login: the access token (15 minutes) of account. */
export const apiLogin = async (account: Account): Promise<string> => {
  const response = await fetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  expect(response.status, `login ${account.email}`).toBe(200);
  const body = (await response.json()) as { data: { access_token: string } };
  return body.data.access_token;
};

/**
 * One authenticated API call; fails the test unless the answer has the
 * status wanted. Returns the body's `data` (undefined for a 204).
 */
export const authCall = async <T>(
  token: string,
  method: string,
  path: string,
  want: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${method} ${path}: ${text}`).toBe(want);
  return (
    text === "" ? undefined : (JSON.parse(text) as { data: T }).data
  ) as T;
};

/** Money as the contract sends it. */
export interface Money {
  amount: number;
  currency: string;
}

/** One order line, the order's own copy (the contract's OrderItem). */
export interface OrderItemRow {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  unit_price: Money;
  quantity: number;
  line_total: Money;
}

/** GET /v1/orders/{id}, as the contract defines it (the fields used here). */
export interface OrderRow {
  id: string;
  code: string;
  status: string;
  items: OrderItemRow[];
  totals: {
    subtotal: Money;
    discount: Money;
    shipping_fee: Money;
    total: Money;
  };
  voucher_code: string | null;
  shipping: {
    courier: string;
    service: string;
    tracking_number: string | null;
    address: {
      recipient_name: string;
      phone: string;
      street: string;
      city: string;
      province: string;
      postal_code: string;
    };
  };
  latest_payment: { status: string } | null;
  payment_expires_at: string;
  paid_at: string | null;
  created_at: string;
}

/** One row of GET /v1/orders (the contract's OrderSummary, fields used here). */
export interface OrderSummaryRow {
  id: string;
  code: string;
  status: string;
  total: Money;
}

/** POST /v1/orders/{id}/pay's answer (the contract's PaymentSession). */
export interface PaymentSessionRow {
  id: string;
  order_id: string;
  provider: string;
  status: string;
  token: string;
  redirect_url: string;
}

/** The address the specs ship to: Bandung, priced by the fixed table. */
export const ADDRESS = {
  label: "Rumah",
  recipient_name: "Pembeli E2E",
  phone: "081234567890",
  street: "Jl. Asia Afrika No. 8",
  city: "Bandung",
  province: "Jawa Barat",
  postal_code: "40111",
} as const;

/** POST /v1/me/addresses: a default address; returns its id. */
export const createAddress = async (token: string): Promise<string> => {
  const address = await authCall<{ id: string }>(
    token,
    "POST",
    "/v1/me/addresses",
    201,
    { ...ADDRESS, is_default: true },
  );
  return address.id;
};

/** POST /v1/cart/items to the buyer's own cart. */
export const addToCart = async (
  token: string,
  variantId: string,
  quantity = 1,
): Promise<void> => {
  const response = await fetch(`${API_URL}/v1/cart/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ variant_id: variantId, quantity }),
  });
  expect([200, 201], `add to cart: ${await response.text()}`).toContain(
    response.status,
  );
};

/** POST /v1/checkout with JNE REG and a fresh Idempotency-Key. */
export const placeOrder = (
  token: string,
  addressId: string,
): Promise<OrderRow> =>
  authCall<OrderRow>(
    token,
    "POST",
    "/v1/checkout",
    201,
    { address_id: addressId, courier: "jne", service: "REG" },
    { "Idempotency-Key": crypto.randomUUID() },
  );

/** POST /v1/orders/{id}/pay: opens a payment with the stack's gateway. */
export const startPayment = (
  token: string,
  orderId: string,
): Promise<PaymentSessionRow> =>
  authCall<PaymentSessionRow>(token, "POST", `/v1/orders/${orderId}/pay`, 201);

/** GET /v1/orders/{id}. */
export const getOrder = (token: string, orderId: string): Promise<OrderRow> =>
  authCall<OrderRow>(token, "GET", `/v1/orders/${orderId}`, 200);

/**
 * Pays with the test gateway what Midtrans would: `api fake-pay` in the
 * api container (make fake-pay), for an order code (its open payment) or
 * a payment's Midtrans order_id. status is Midtrans' transaction_status.
 */
export const fakePay = (
  codeOrPaymentId: string,
  status = "settlement",
): void => {
  compose("exec", "-T", "api", "/api", "fake-pay", codeOrPaymentId, status);
};

/** The Midtrans order_id (`<code>-XXXXXX`) of a payment, from Postgres. */
export const providerOrderId = (paymentId: string): string =>
  psql(`SELECT provider_order_id FROM payments WHERE id = '${paymentId}'`);

/** A product's variants and their stock, from the API. */
export const productVariants = async (
  slug: string,
): Promise<
  { id: string; sku: string; name: string; price: Money; stock: number }[]
> => {
  const response = await fetch(`${API_URL}/v1/products/${slug}`);
  expect(response.status, `GET /v1/products/${slug}`).toBe(200);
  const body = (await response.json()) as {
    data: {
      variants: {
        id: string;
        sku: string;
        name: string;
        price: Money;
        stock: number;
      }[];
    };
  };
  return body.data.variants;
};

/**
 * The stock of every variant of a product, read now, and a function that
 * puts exactly that stock back. Specs that place orders use a seeded
 * product no other spec opens and restore its stock afterwards, so
 * repeated runs never sell it out and every other spec sees the catalog
 * `make seed` wrote. Stock is not an edit: the product's updated_at (and
 * the sitemap's lastmod) does not move.
 */
export const keepStock = async (slug: string): Promise<() => void> => {
  const variants = await productVariants(slug);
  return () => {
    for (const variant of variants) {
      psql(
        `UPDATE product_variants SET stock = ${String(variant.stock)} WHERE id = '${variant.id}'`,
      );
    }
  };
};
