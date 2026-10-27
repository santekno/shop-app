/** The query parameter of /masuk that names the page to go back to. */
export const RETURN_TO_PARAM = "kembali";

/** Longer than any page of ours; anything longer is not a link we made. */
const MAX_RETURN_TO_LENGTH = 2048;

/** Pages it makes no sense to come back to after logging in. */
const AUTH_PAGES = new Set(["/masuk", "/daftar"]);

/**
 * The page to open after a login: `value` (the `kembali` parameter) when
 * it is a path on this site, otherwise "/".
 *
 * The parameter comes from the URL, and anyone can send a buyer a link to
 * /masuk?kembali=… . Following it blindly is an **open redirect**: a link
 * that starts on the real shop's login page and, after a genuine login,
 * lands on `https://evil.example/masuk` dressed as the shop, which then
 * asks for the password "again". So only a path on our own origin passes:
 *
 * 1. It must start with one "/" (a relative path). "//evil.example" and
 *    "/\evil.example" start with a slash too, but browsers read both as
 *    another host (a protocol-relative URL; the URL parser turns "\" into
 *    "/" for http), so they are refused outright.
 * 2. It is then parsed against our own origin with the URL parser, the
 *    same one the browser will use when it follows it, and the result
 *    must still be our origin. This is the check that matters: whatever
 *    trick gets past (1), such as a tab or a newline inside "//" (the
 *    parser removes them), changes the origin and is refused here.
 * 3. Only the path, query and hash of the parsed URL are returned, never
 *    the original string, so what is navigated to is exactly what was
 *    checked.
 *
 * Back to /masuk or /daftar would be a loop, so those become "/" too.
 */
export const safeReturnPath = (
  value: string | null | undefined,
  origin: string = window.location.origin,
): string => {
  if (
    value === null ||
    value === undefined ||
    value.length > MAX_RETURN_TO_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return "/";
  }
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin || AUTH_PAGES.has(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
};

/** /masuk, with the page to come back to after logging in. */
export const loginPathFor = (returnTo: string): string =>
  `/masuk?${new URLSearchParams({ [RETURN_TO_PARAM]: returnTo }).toString()}`;
