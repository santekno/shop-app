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

  return (path: string): string => {
    if (!path.startsWith("/")) {
      throw new TypeError(`API path must start with "/": ${path}`);
    }
    return prefix + path;
  };
};
