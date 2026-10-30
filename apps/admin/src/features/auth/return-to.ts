/** The query parameter of /masuk that names the page to go back to. */
export const RETURN_TO_PARAM = "kembali";

/** Longer than any page of ours; anything longer is not a link we made. */
const MAX_RETURN_TO_LENGTH = 2048;

/** Pages it makes no sense to come back to after logging in. */
const AUTH_PAGES = new Set(["/masuk"]);

/**
 * The page to open after a login: `value` (the `kembali` parameter) when
 * it is a path on this site, otherwise "/".
 *
 * The parameter comes from the URL, and anyone can send a seller a link to
 * /masuk?kembali=… . Following it blindly is an **open redirect**: a link
 * that starts on the real dashboard's login page and, after a genuine login,
 * lands on `https://evil.example/masuk` dressed as the dashboard, which then
 * asks for the password "again". So only a path on our own origin passes:
 *
 * 1. It must start with one "/" (a relative path). "//evil.example" and
 *    "/\evil.example" start with a slash too, but browsers read both as
 *    another host (a protocol-relative URL; the URL parser turns "\" into
 *    "/" for http), so they are refused outright. This is only a fast
 *    path: the checks that matter run on the parsed result, below.
 * 2. It is then parsed against our own origin with the URL parser, the
 *    same one the browser will use when it follows it, and the result
 *    must still be our origin. Whatever trick gets past (1), such as a tab
 *    or a newline inside "//" (the parser removes them), changes the
 *    origin and is refused here.
 * 3. The parsed path must still start with exactly one "/". Parsing also
 *    normalises the path: it removes dot segments ("/./", "/x/../", and
 *    their encoded form "%2e") and turns "\" into "/". So "/.//evil.example"
 *    or "/x/..//evil.example" parse to a URL on our origin whose path is
 *    "//evil.example", which passes (2) but, handed to the browser as a
 *    string, is a protocol-relative URL to another host again. Checking
 *    the input in (1) cannot see this; only the output can.
 * 4. Only the path, query and hash of the parsed URL are returned, never
 *    the original string, so what is navigated to is exactly what was
 *    checked in (2) and (3).
 *
 * Back to /masuk would be a loop, so it becomes "/" too.
 */
export const safeReturnPath = (
  value: string | null | undefined,
  origin: string = window.location.origin,
): string => {
  // (1) The input: one leading "/", and not too long.
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
  // (2) Parsed the way the browser will, it must stay on our origin.
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  // (3) The normalised path must not have become "//host".
  if (url.pathname.startsWith("//")) return "/";
  if (AUTH_PAGES.has(url.pathname)) return "/";
  // (4) Only what was checked leaves.
  return `${url.pathname}${url.search}${url.hash}`;
};

/** /masuk, with the page to come back to after logging in. */
export const loginPathFor = (returnTo: string): string =>
  `/masuk?${new URLSearchParams({ [RETURN_TO_PARAM]: returnTo }).toString()}`;
