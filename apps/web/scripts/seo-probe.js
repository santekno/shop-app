// What a crawler that does not run JavaScript sees on one page (Bab 11
// artikel 07). It fetches the URL once, the way a search engine's first
// pass does, and reports what the HTML itself carries: no browser, no
// scripts, no API calls of its own.
//
//   node apps/web/scripts/seo-probe.js http://localhost:34173/produk/kaos-polos
//
// Googlebot does render JavaScript, later, in a second wave with a budget;
// many other crawlers and every link preview (WhatsApp, Slack, X) never
// do. Whatever is missing here is missing for them.

const url = process.argv[2];
if (url === undefined) {
  console.error("usage: node apps/web/scripts/seo-probe.js <url>");
  process.exit(2);
}

const started = performance.now();
const response = await fetch(url, {
  headers: {
    // Googlebot's own user agent: a site that serves crawlers something
    // else (cloaking) shows it here.
    "User-Agent":
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    Accept: "text/html",
  },
  redirect: "manual",
});
const html = await response.text();
const elapsed = Math.round(performance.now() - started);

/** The first capture group of `pattern` in the HTML, or "—". */
const first = (pattern) => pattern.exec(html)?.[1]?.trim() ?? "—";

/** The content of <meta name|property="key">, in either attribute order. */
const meta = (key) => {
  const nameFirst = first(
    new RegExp(
      `<meta[^>]+(?:name|property)="${key}"[^>]+content="([^"]*)"`,
      "i",
    ),
  );
  if (nameFirst !== "—") return nameFirst;
  return first(
    new RegExp(
      `<meta[^>]+content="([^"]*)"[^>]+(?:name|property)="${key}"`,
      "i",
    ),
  );
};

// The text a reader would see: scripts, styles and tags removed.
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const jsonLd = [
  ...html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  ),
].map((match) => {
  try {
    const value = JSON.parse(match[1]);
    return value["@type"] ?? "?";
  } catch {
    return "invalid JSON";
  }
});

const report = {
  url,
  status: response.status,
  "time (ms)": elapsed,
  "HTML (bytes)": Buffer.byteLength(html),
  title: first(/<title[^>]*>([\s\S]*?)<\/title>/i),
  description: meta("description"),
  robots: meta("robots"),
  canonical: first(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i),
  "og:title": meta("og:title"),
  "og:image": meta("og:image"),
  h1: first(/<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, ""),
  "links (<a href>)": (html.match(/<a\s[^>]*href=/gi) ?? []).length,
  "images (<img>)": (html.match(/<img\s/gi) ?? []).length,
  "JSON-LD": jsonLd.length === 0 ? "—" : jsonLd.join(", "),
  "visible text (chars)": text.length,
  "visible text (start)": text.slice(0, 160) || "—",
};

for (const [key, value] of Object.entries(report)) {
  console.log(`${key.padEnd(22)} ${String(value)}`);
}
