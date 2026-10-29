/**
 * Structured data for search engines (Bab 11 artikel 10): one
 * <script type="application/ld+json"> holding `data` as JSON.
 *
 * The JSON goes into the HTML as raw text, so it must not be able to end
 * the element early. JSON.stringify leaves "<" alone: a product called
 * `</script><script>alert(1)</script>` would close the data block and
 * start a real script. Writing "<" as its JSON escape \u003c (and ">" and
 * "&" too) keeps the same value for a JSON parser and leaves no markup
 * for the HTML parser to find. U+2028 and U+2029 are escaped as well:
 * valid in JSON, line breaks in older JavaScript parsers.
 *
 * No nonce: the browser never runs a data block (its type is not
 * JavaScript), so the CSP's script-src does not apply to it.
 *
 * A server component: it renders on the server only, and its code never
 * reaches the browser.
 */
export const serializeJsonLd = (data: unknown): string =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
