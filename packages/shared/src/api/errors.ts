/**
 * The body of every API error, as api/openapi.yaml defines it
 * (components.schemas.Error):
 *
 *   {"error":{"code":"NOT_FOUND","message":"product not found"}}
 *
 * The request ID is not in the body: it travels in the X-Request-ID
 * response header, which the API exposes to browsers through CORS.
 */
interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks at run time that a parsed JSON value has the error body's shape.
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
  /** Machine-readable, SCREAMING_SNAKE_CASE. */
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
