import type { ErrorBody } from "./types.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks at run time that a parsed JSON value has the shape of the API's
 * error body, `{"error":{"code","message","details"}}` (the Error schema in
 * api/openapi.yaml). The request ID is not in the body: it travels in the
 * X-Request-ID response header, which the API exposes to browsers.
 * TypeScript types are erased, so a value from the network is `unknown`
 * until code like this has looked at it.
 */
export const isErrorBody = (value: unknown): value is ErrorBody => {
  if (!isObject(value) || !isObject(value.error)) return false;
  const { code, message, details } = value.error;
  return (
    typeof code === "string" &&
    typeof message === "string" &&
    (details === undefined || isObject(details))
  );
};

/**
 * The error codes api/openapi.yaml documents, as an array that exists at
 * run time. `as const` keeps each element as its literal string ("NOT_FOUND")
 * instead of widening it to `string`, and makes the array readonly. A test
 * compares this list with the contract, so a code the API adds cannot be
 * forgotten here.
 */
export const SERVER_ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNKNOWN_CATEGORY",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "TIMEOUT",
  "SLUG_TAKEN",
  "SKU_TAKEN",
  "EMAIL_TAKEN",
  "EMAIL_UNVERIFIED",
  "INVALID_CREDENTIALS",
  "TOKEN_INVALID",
  "TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "ADDRESS_LIMIT_REACHED",
  "DEFAULT_ADDRESS_REQUIRED",
  "INTERNAL_ERROR",
  // Cart, checkout and orders (Bab 5).
  "CART_NOT_FOUND",
  "CART_EMPTY",
  "CART_FULL",
  "CART_CHANGED",
  "VARIANT_UNAVAILABLE",
  "INSUFFICIENT_STOCK",
  "QUANTITY_LIMIT",
  "CHECKOUT_PROBLEMS",
  "VOUCHER_NOT_APPLICABLE",
  "SHIPPING_UNAVAILABLE",
  "TOO_MANY_PENDING_ORDERS",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
  "INVALID_TRANSITION",
  "VERSION_CONFLICT",
  "UPSTREAM_UNAVAILABLE",
  // Payments and product photos (Bab 6).
  "PAYMENTS_DISABLED",
  "PAYMENT_WINDOW_CLOSED",
  "INVALID_SIGNATURE",
  "STORAGE_DISABLED",
  "IMAGE_LIMIT_REACHED",
  "UPLOAD_MISSING",
  "UPLOAD_INVALID",
] as const;

/**
 * One of SERVER_ERROR_CODES. A union of string literals: a value of this
 * type can only be one of these strings, so a typo such as "NOT_FOUN" is a
 * compile error. `typeof SERVER_ERROR_CODES` is the array's type, and
 * `[number]` is the type of any element in it. Go would use a named string
 * type with constants; TypeScript checks the literal values themselves.
 */
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

/** The codes the client sets itself when there is no usable answer. */
export type ClientErrorCode =
  "NETWORK_ERROR" | "CLIENT_TIMEOUT" | "ABORTED" | "INVALID_RESPONSE";

/** Every code an ApiError is known to carry: a union of two unions. */
export type ApiErrorCode = ServerErrorCode | ClientErrorCode;

/** What `new ApiError(…)` needs. */
export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  cause?: unknown;
}

/**
 * The one error type the API client throws, for every kind of failure:
 *
 * - the API answered with an error body: `status` and `code` come from it
 *   (404 `NOT_FOUND`, 400 `VALIDATION_FAILED`, …);
 * - no answer arrived: `status` is 0 and `code` is `NETWORK_ERROR`,
 *   `CLIENT_TIMEOUT` or `ABORTED`;
 * - the answer is not what the contract promises (not JSON, or an error
 *   status without the error body): `code` is `INVALID_RESPONSE`.
 *
 * In Go a function returns an error value; in JavaScript it throws, and the
 * caller catches. One error type means one `catch` that can branch on
 * `code`, like errors.As in Go. Branch on `code`, never on `message`.
 */
export class ApiError extends Error {
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number;
  /**
   * Machine-readable, SCREAMING_SNAKE_CASE; usually an ApiErrorCode. Typed
   * as string because a newer API may send a code this client does not know
   * yet. Compare it through isApiError, which only accepts known codes.
   */
  readonly code: string;
  /** Structured context, for example which fields failed validation; `{}` when none. */
  readonly details: Readonly<Record<string, unknown>>;
  /** The X-Request-ID of the response; quote it when reporting a problem. */
  readonly requestId: string | undefined;

  constructor({
    status,
    code,
    message,
    details = {},
    requestId,
    cause,
  }: ApiErrorInit) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

/**
 * Narrows an unknown caught value to an ApiError, optionally one of the
 * given codes. After `if (isApiError(error, "NOT_FOUND"))` TypeScript
 * knows `error` is an ApiError, like errors.As in Go.
 *
 * @example
 *   try {
 *     await getProduct(api, slug);
 *   } catch (error) {
 *     if (isApiError(error, "NOT_FOUND")) return showNotFound();
 *     throw error;
 *   }
 */
export const isApiError = (
  error: unknown,
  ...codes: readonly ApiErrorCode[]
): error is ApiError =>
  error instanceof ApiError &&
  (codes.length === 0 || codes.some((code) => code === error.code));
