import { retry } from "../lib/async.ts";
import { ApiError, isErrorBody } from "./errors.ts";
import { createUrlBuilder } from "./url.ts";
import type { QueryParams } from "./url.ts";

/** The HTTP methods the GoShop API uses. */
export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Every client setting: what the client runs with once defaults are filled in. */
export interface ApiClientConfig {
  /** Where the API lives, for example "http://localhost:8080". */
  baseUrl: string;
  /** Abort an attempt that has no complete response after this long. Default 10 000. */
  timeoutMs: number;
  /** Extra attempts for a GET that failed on the network, timed out, or got 502/503/504. Default 0. */
  retries: number;
  /** Wait before the first retry, doubled before each later one. Default 300. */
  retryDelayMs: number;
  /** The fetch to call; tests pass a fake. Default: the global fetch. */
  fetch: typeof fetch;
  /**
   * The cookie policy of every request this client sends, unless a request
   * names its own (the web session calls in auth.ts ask for "include").
   * Default `undefined`: leave it to fetch. In a browser that means
   * "same-origin", so a cross-origin API never sees a cookie; the web apps
   * rely on that and set nothing. Expo's fetch (the global fetch in the
   * mobile app since SDK 52) defaults to "include" and keeps a native cookie
   * jar instead, so the mobile app, which sends a bearer token and never a
   * cookie, sets "omit" here (Bab 13 artikel 12).
   */
  credentials: RequestCredentials | undefined;
}

/**
 * What createApiClient takes: `baseUrl` is required, every other setting is
 * optional. Built from ApiClientConfig with utility types instead of a
 * second hand-written interface, so the two can never disagree:
 * Pick keeps only the named fields, Omit drops them, Partial makes every
 * field optional.
 */
export type ApiClientOptions = Pick<ApiClientConfig, "baseUrl"> &
  Partial<Omit<ApiClientConfig, "baseUrl">>;

/**
 * The defaults. `Readonly` is checked by the compiler only: assigning to
 * `DEFAULTS.timeoutMs` is a type error, but nothing stops it at run time.
 * Nothing outside this file can reach the object anyway; it is not exported.
 */
const DEFAULTS: Readonly<
  Omit<ApiClientConfig, "baseUrl" | "fetch" | "credentials">
> = {
  timeoutMs: 10_000,
  retries: 0,
  retryDelayMs: 300,
};

/**
 * Per-request settings. `timeoutMs` and `retries` override the client's for
 * one request; `retries` is ignored unless the method is GET or HEAD.
 */
export interface RequestOptions extends Partial<
  Pick<ApiClientConfig, "timeoutMs" | "retries">
> {
  /** HTTP method. Default "GET". */
  method?: HttpMethod;
  query?: QueryParams;
  /** Sent as JSON. Leave it out for a request without a body. */
  body?: unknown;
  headers?: HeadersInit;
  /** Abort it to cancel the request, for example when a component unmounts. */
  signal?: AbortSignal;
  /**
   * Whether the browser sends and stores cookies for this request. Leave it
   * out (the client's `credentials`, or else fetch's default: in a browser
   * "same-origin", never for a cross-origin API) on every call except the
   * web session's (auth.ts), which need "include" for the httpOnly refresh
   * cookie.
   */
  credentials?: RequestCredentials;
}

/** JSON.parse that answers `undefined` instead of throwing; JSON never yields `undefined` itself. */
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Turns a response into its JSON value, or throws the ApiError it describes. */
const readResponse = async (response: Response): Promise<unknown> => {
  const requestId = response.headers.get("X-Request-ID") ?? undefined;
  const text = await response.text();
  const json = parseJson(text);

  if (response.ok) {
    // 204 No Content (a DELETE) has no body at all.
    if (text === "") return undefined;
    if (json !== undefined) return json;
  } else if (isErrorBody(json)) {
    const { code, message, details } = json.error;
    throw new ApiError({
      status: response.status,
      code,
      message,
      details,
      requestId,
    });
  }
  throw new ApiError({
    status: response.status,
    code: "INVALID_RESPONSE",
    message: `unexpected response from the API (HTTP ${response.status})`,
    requestId,
  });
};

/** Failures that may pass on their own: no answer, or a gateway or timeout status. */
const isRetryable = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.code === "NETWORK_ERROR" ||
    error.code === "CLIENT_TIMEOUT" ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504);

/**
 * Creates the GoShop API client: `request<T>` sends one call and returns the
 * parsed JSON as a `T`, or throws an ApiError.
 *
 * @example
 *   const api = createApiClient({ baseUrl: "http://localhost:8080" });
 *   const body = await api.request<CategoryList>("/v1/categories", { signal });
 *   body.data; // Category[]
 */
export const createApiClient = (options: ApiClientOptions) => {
  // Defaults in the destructuring, not `{ ...DEFAULTS, ...options }`: a
  // spread copies an explicit `timeoutMs: undefined` over the default,
  // while a destructuring default also replaces `undefined`.
  const {
    baseUrl,
    timeoutMs: defaultTimeoutMs = DEFAULTS.timeoutMs,
    retries: defaultRetries = DEFAULTS.retries,
    retryDelayMs = DEFAULTS.retryDelayMs,
    // Called as a plain function below, never as `options.fetch(…)`: the
    // browser's fetch throws "Illegal invocation" when `this` is not window.
    fetch: fetchFn = globalThis.fetch,
    credentials: defaultCredentials,
  } = options;
  const urlFor = createUrlBuilder(baseUrl);

  /** One attempt: fetch, read the body, map every failure to an ApiError. */
  const send = async (
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> => {
    // A controller of our own aborts the fetch when the time is up or when
    // the caller's signal aborts, like context.WithTimeout(parent, d) in Go.
    // The timer aborts with a reason of its own, so the catch below can
    // tell our timeout from the caller's cancel.
    const controller = new AbortController();
    const timeout = new DOMException(
      `no response within ${timeoutMs} ms`,
      "TimeoutError",
    );
    const timer = setTimeout(() => {
      controller.abort(timeout);
    }, timeoutMs);
    const onAbort = () => {
      controller.abort(signal?.reason);
    };
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
      // Reading the body is inside the try too: the timeout covers a
      // response whose headers arrive but whose body never ends.
      return await readResponse(response);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) {
        throw new ApiError({
          status: 0,
          code: "ABORTED",
          message: "the request was cancelled",
          cause: error,
        });
      }
      if (controller.signal.reason === timeout) {
        throw new ApiError({
          status: 0,
          code: "CLIENT_TIMEOUT",
          message: `the API did not answer within ${timeoutMs} ms`,
          cause: error,
        });
      }
      // fetch rejects with a TypeError when the server cannot be reached,
      // and also when CORS blocks the response: the browser hides which.
      throw new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "the API could not be reached",
        cause: error,
      });
    } finally {
      // Runs on every path, like a Go defer: no timer or listener leaks.
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };

  /**
   * `<T>` is a type parameter, like `[T any]` in Go: the caller names the
   * type of the JSON it expects. Unlike retry's T, which flows in from the
   * function it is given, this T only appears in the result, so it is a
   * promise the caller makes rather than something the compiler can check;
   * JSON.parse has no type information to check it against. That is why
   * only the endpoint functions call request, with types generated from
   * api/openapi.yaml.
   *
   * Go (as of 1.26, the course's version) cannot write this as a method:
   * methods have no type parameters, so a Go client needs a package-level
   * `func Get[T any](c *Client, …) (T, error)`.
   */
  const request = async <T>(
    path: string,
    {
      method = "GET",
      query,
      body,
      headers,
      signal,
      credentials = defaultCredentials,
      timeoutMs = defaultTimeoutMs,
      retries = defaultRetries,
    }: RequestOptions = {},
  ): Promise<T> => {
    const url = urlFor(path, query);
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has("Accept")) {
      requestHeaders.set("Accept", "application/json");
    }
    const init: RequestInit = { method, headers: requestHeaders };
    if (credentials !== undefined) init.credentials = credentials;
    if (body !== undefined) {
      requestHeaders.set("Content-Type", "application/json");
      init.body = JSON.stringify(body);
    }
    const attempt = async () => (await send(url, init, signal, timeoutMs)) as T;

    // Only GET and HEAD are safe to repeat: a retried POST could, for
    // example, place the same order twice.
    if (method !== "GET" && method !== "HEAD") return attempt();
    try {
      return await retry(attempt, {
        retries,
        delayMs: retryDelayMs,
        shouldRetry: isRetryable,
        signal,
      });
    } catch (error) {
      // Anything but an ApiError comes from retry itself: the caller's
      // signal aborted while it waited between two attempts, or `retries`
      // was not a whole number (a RangeError, rethrown as it is).
      if (error instanceof ApiError || !signal?.aborted) throw error;
      throw new ApiError({
        status: 0,
        code: "ABORTED",
        message: "the request was cancelled",
        cause: error,
      });
    }
  };

  return { request };
};

/** The client's type, taken from what createApiClient returns. */
export type ApiClient = ReturnType<typeof createApiClient>;
