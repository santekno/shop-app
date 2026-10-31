// The network as the tests see it: a typed fake of `fetch`, installed as the
// global fetch before any test file loads (src/test/install-fetch.ts), so
// src/lib/api.ts builds its client on it exactly as it builds it on Expo's
// fetch in the app. Everything above fetch (the shared client's URL
// building, error mapping, retries, abort signals) runs for real.
//
// Why not MSW: `msw/native` needs URL and TextEncoder polyfills that only
// matter on a device, and under Jest it would intercept the same global
// fetch this file replaces, with MSW 3's ESM entry points to map through
// Jest's resolver on top. The app reaches the network only through
// createApiClient → fetch, so a fake at that boundary covers the same code
// with nothing in between.
//
// Two rules the Bab 12 review taught (docs/testing-ai-review.md):
//
// - an unanswered request fails the test: it is recorded, rejected like a
//   network failure, and jest.setup.ts fails the test in afterEach, even
//   when the code under test handled the rejection and showed an error;
// - a reply can be held back (`deferred`), so a test can look at the
//   screen between the request and the answer instead of relying on a
//   mock faster than any real network.

/** One request as the fake fetch received it. */
export interface FakeRequest {
  method: string;
  url: URL;
  init: RequestInit;
}

type Handler = (request: FakeRequest) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
  once: boolean;
}

// Kept on globalThis: a test that calls jest.resetModules() gets a fresh
// copy of this module, while the global fetch is still the first copy's.
// One shared state keeps both copies talking about the same requests.
interface FakeApiState {
  routes: Route[];
  received: FakeRequest[];
  unhandled: string[];
}
const holder = globalThis as typeof globalThis & {
  __goshopFakeApi?: FakeApiState;
};
holder.__goshopFakeApi ??= { routes: [], received: [], unhandled: [] };
const { routes, received, unhandled } = holder.__goshopFakeApi;

// The signal's reason, as the real fetch rejects with it. The shared
// client sets an Error (a DOMException) as the reason of every abort.
const abortReason = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("aborted", "AbortError");

/**
 * The fake `fetch`. A one-time handler answers before a lasting one, in the
 * order they were added; a request no handler matches is recorded as
 * unhandled and rejects with React Native's network TypeError. The
 * request's signal aborts a pending answer, as the real fetch does.
 */
export const fakeFetch: typeof fetch = (input, init = {}) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const method = (init.method ?? "GET").toUpperCase();
  const request: FakeRequest = { method, url, init };
  received.push(request);

  const signal = init.signal ?? undefined;
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  const index = routes.findIndex(
    (route) => route.method === method && route.path === url.pathname,
  );
  const route = index === -1 ? undefined : routes[index];
  if (route === undefined) {
    unhandled.push(`${method} ${url.pathname}${url.search}`);
    return Promise.reject(new TypeError("Network request failed"));
  }
  if (route.once) routes.splice(index, 1);

  return new Promise<Response>((resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        reject(abortReason(signal));
      },
      { once: true },
    );
    Promise.resolve()
      .then(() => route.handler(request))
      .then(resolve, reject);
  });
};

const add = (method: string, path: string, handler: Handler, once: boolean) => {
  const route = { method, path, handler, once };
  // One-time handlers go before every lasting one, after earlier one-time
  // ones: a test queues answers in the order the requests will come.
  const firstLasting = routes.findIndex((r) => !r.once);
  if (once && firstLasting !== -1) routes.splice(firstLasting, 0, route);
  else routes.push(route);
};

export const fakeApi = {
  /** Answers every `method path` request with `handler` from now on. */
  on(method: string, path: string, handler: Handler) {
    add(method, path, handler, false);
  },
  /** Answers the next `method path` request only. */
  once(method: string, path: string, handler: Handler) {
    add(method, path, handler, true);
  },
  /** Every request received so far, oldest first. */
  requests: (method?: string, path?: string): FakeRequest[] =>
    received.filter(
      (r) =>
        (method === undefined || r.method === method) &&
        (path === undefined || r.url.pathname === path),
    ),
  /** Requests no handler answered since the last reset. */
  unhandled: (): readonly string[] => [...unhandled],
  reset() {
    routes.length = 0;
    received.length = 0;
    unhandled.length = 0;
  },
};

/** A JSON answer, the way the API sends one. */
export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** The API's error envelope, with the X-Request-ID it sends. */
export const apiError = (
  status: number,
  code: string,
  requestId?: string,
): Response =>
  json(
    { error: { code, message: `test ${code}` } },
    status,
    requestId === undefined ? {} : { "X-Request-ID": requestId },
  );

/** A network failure: what fetch does when the server cannot be reached. */
export const networkDown = (): Promise<Response> =>
  Promise.reject(new TypeError("Network request failed"));

/** An answer the test releases itself, to look at the screen meanwhile. */
export const deferred = () => {
  let release: (response: Response) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const promise = new Promise<Response>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return {
    handler: (): Promise<Response> => promise,
    resolve: (response: Response) => {
      release(response);
    },
    reject: (error: unknown) => {
      fail(error);
    },
  };
};
