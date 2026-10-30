import { describe, expect, it } from "vitest";
import { RETURN_TO_PARAM, loginPathFor, safeReturnPath } from "./return-to.ts";

const ORIGIN = "https://goshop.test";
const safe = (value: string | null | undefined) =>
  safeReturnPath(value, ORIGIN);

describe("safeReturnPath", () => {
  it.each([
    ["/akun", "/akun"],
    ["/produk/kaos?x=1#a", "/produk/kaos?x=1#a"],
    ["/keranjang?ukuran=M&warna=hitam", "/keranjang?ukuran=M&warna=hitam"],
    ["/", "/"],
    // An encoded slash is part of a path on our site, not a host.
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
    // Dot segments are resolved by the parser, still on our origin.
    ["/produk/../akun", "/akun"],
  ])("keeps the path on this site %s", (value, expected) => {
    expect(safe(value)).toBe(expected);
  });

  it.each([
    ["a protocol-relative host", "//evil.example/x"],
    ["a backslash host", "/\\evil.example/x"],
    ["a tab inside //", "/\t/evil.example/x"],
    ["a newline inside //", "/\n/evil.example/x"],
    ["a carriage return inside //", "/\r/evil.example/x"],
    ["an absolute URL", "https://evil.example"],
    ["an absolute URL to our own host", `${ORIGIN}/akun`],
    ["a script", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["a relative path", "akun"],
    ["a query alone", "?x=1"],
    ["a hash alone", "#konten"],
    ["empty", ""],
    ["a space before the slash", " /akun"],
  ])("refuses %s", (_name, value) => {
    expect(safe(value)).toBe("/");
  });

  // Each of these passes the input check (one leading "/") and parses to
  // our origin, but the parser's normalisation (dot segments removed, the
  // encoded %2e read as a dot, a backslash turned into "/") leaves the path
  // "//evil.example…": a protocol-relative URL to another host once it is
  // returned as a string. Only the check on the parsed path refuses them.
  it.each([
    ["a dot segment before //", "/.//evil.example"],
    ["a parent segment before //", "/x/..//evil.example/masuk"],
    ["an encoded dot segment", "/%2e//evil.example"],
    ["an encoded dot segment, upper case", "/%2E//evil.example"],
    ["an encoded parent segment", "/x/%2e%2e//evil.example"],
    ["a dot segment before a backslash", "/./\\evil.example"],
    ["a dot segment, backslash first", "/.\\/evil.example"],
    ["an encoded dot segment before a backslash", "/%2e/\\evil.example"],
    ["a dot segment, with a query and hash", "/.//evil.example/x?y=1#z"],
  ])("refuses %s, which normalises to //host", (_name, value) => {
    expect(new URL(value, ORIGIN).pathname.startsWith("//")).toBe(true);
    expect(safe(value)).toBe("/");
  });

  it.each([
    // An ordinary dot segment still resolves to a path on our site.
    ["/./akun", "/akun"],
    ["/x/../akun?y=1", "/akun?y=1"],
    // An encoded slash stays encoded: one path segment, not a host.
    ["/.%2F/evil.example", "/.%2F/evil.example"],
  ])("keeps %s, whose parsed path has one leading slash", (value, expected) => {
    expect(safe(value)).toBe(expected);
  });

  it.each([null, undefined])("is / for %s (no parameter)", (value) => {
    expect(safe(value)).toBe("/");
  });

  it.each(["/masuk", "/masuk?kembali=/akun", "/masuk#form"])(
    "sends %s to / instead of a loop",
    (value) => {
      expect(safe(value)).toBe("/");
    },
  );

  // The dashboard has no sign-up page: /daftar is an ordinary path here
  // (the storefront's copy refuses it), and a 404 inside the dashboard.
  it.each(["/daftar", "/masukan", "/masuk/lagi"])(
    "keeps %s, which is not the login page",
    (value) => {
      expect(safe(value)).toBe(value);
    },
  );

  it("keeps a path of exactly 2 048 characters and refuses a longer one", () => {
    const path = (length: number) => `/${"a".repeat(length - 1)}`;

    expect(safe(path(2048))).toBe(path(2048));
    expect(safe(path(2049))).toBe("/");
  });

  it("returns the parsed URL, never the string it was given", () => {
    // The parser normalises; what is navigated to is what was checked.
    expect(safe("/produk/kaos?q=a b")).toBe("/produk/kaos?q=a%20b");
  });

  it("is / when the value cannot be parsed against the origin", () => {
    expect(safeReturnPath("/akun", "bukan-origin")).toBe("/");
  });

  it("checks against the page's own origin by default", () => {
    expect(safeReturnPath("/akun")).toBe("/akun");
    expect(safeReturnPath("//evil.example")).toBe("/");
  });
});

describe("loginPathFor", () => {
  it("puts the page in the kembali parameter, encoded", () => {
    expect(RETURN_TO_PARAM).toBe("kembali");
    expect(loginPathFor("/akun")).toBe("/masuk?kembali=%2Fakun");
    expect(loginPathFor("/produk/kaos?x=1&y=2#a")).toBe(
      "/masuk?kembali=%2Fproduk%2Fkaos%3Fx%3D1%26y%3D2%23a",
    );
  });

  it("round-trips through the URL into safeReturnPath", () => {
    const target = "/produk/kaos?x=1&y=2#a";
    const url = new URL(loginPathFor(target), ORIGIN);

    expect(safe(url.searchParams.get(RETURN_TO_PARAM))).toBe(target);
  });
});
