/**
 * A value a query parameter may take. `undefined` and `null` mean "leave the
 * parameter out", so callers can pass optional filters as they are.
 */
export type QueryValue = string | number | boolean | null | undefined;

/** Query parameters by name, for example `{ category: "kaos", limit: 20 }`. */
export type QueryParams = Readonly<Record<string, QueryValue>>;

/**
 * Encodes query parameters, skipping the ones that are `undefined` or
 * `null`. Returns "" when nothing is left.
 *
 * @example
 *   toQueryString({ q: "kaos polos", limit: 20, cursor: null });
 *   // "q=kaos+polos&limit=20"
 */
export const toQueryString = (query: QueryParams): string => {
  const params = new URLSearchParams();
  // Object.entries gives [key, value] pairs; destructuring names both parts,
  // like `for key, value := range m` in Go. Unlike a Go map, the order is
  // fixed: keys that look like whole numbers ("2", "10") first, ascending,
  // then every other key in the order it was written.
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  return params.toString();
};

/**
 * Builds full API URLs from paths such as "/v1/categories".
 *
 * `createUrlBuilder` checks the base URL once and returns an arrow function
 * that remembers it: a closure, like a Go func literal that captures a
 * variable from the function around it. Every later call reuses the checked
 * value instead of parsing the base URL again.
 *
 * @example
 *   const urlFor = createUrlBuilder("http://localhost:8080/");
 *   urlFor("/v1/categories"); // "http://localhost:8080/v1/categories"
 *   urlFor("/v1/products", { category: "kaos", limit: 20 });
 *   // "http://localhost:8080/v1/products?category=kaos&limit=20"
 */
export const createUrlBuilder = (baseUrl: string) => {
  // `new URL` throws a TypeError for a malformed URL, so a typo in the
  // configuration fails at start-up, not at the first request.
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError(`API base URL must be http or https: ${baseUrl}`);
  }
  // Checked on href, not on base.search and base.hash: for a bare "?" or
  // "#" ("http://localhost:8080/?") both are "", but href keeps the
  // character, and the prefix below would put it in front of every path.
  // A "?" or "#" anywhere else in a URL is percent-encoded, so any one in
  // href starts a query or a fragment.
  if (/[?#]/.test(base.href)) {
    throw new TypeError(
      `API base URL must not have a query or a fragment: ${baseUrl}`,
    );
  }
  // "https://api.example.com/" and "https://api.example.com" both become
  // "https://api.example.com", so joining with "/v1/..." never gives "//".
  const prefix = base.href.replace(/\/+$/, "");

  // `query = {}` is a default parameter: a call without a second argument
  // gets an empty object instead of `undefined`.
  return (path: string, query: QueryParams = {}): string => {
    if (!path.startsWith("/")) {
      throw new TypeError(`API path must start with "/": ${path}`);
    }
    const search = toQueryString(query);
    return search === "" ? prefix + path : `${prefix}${path}?${search}`;
  };
};
