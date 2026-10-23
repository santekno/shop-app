import { describe, expect, it } from "vitest";
import { createUrlBuilder, toQueryString } from "./url.ts";

describe("toQueryString", () => {
  it("returns an empty string for no parameters", () => {
    expect(toQueryString({})).toBe("");
  });

  it("skips undefined and null but keeps 0, false and the empty string", () => {
    expect(
      toQueryString({
        a: undefined,
        zero: 0,
        b: null,
        no: false,
        empty: "",
      }),
    ).toBe("zero=0&no=false&empty=");
  });

  it("returns an empty string when every value is undefined or null", () => {
    expect(toQueryString({ cursor: null, q: undefined })).toBe("");
  });

  it("encodes spaces as + and escapes reserved characters", () => {
    expect(toQueryString({ q: "kaos polos", tag: "a&b=c/d?" })).toBe(
      "q=kaos+polos&tag=a%26b%3Dc%2Fd%3F",
    );
  });

  it("keeps the order other keys were written in", () => {
    expect(toQueryString({ z: 1, a: 2, m: true })).toBe("z=1&a=2&m=true");
  });

  it("puts integer-like keys first, in ascending order (Object.entries order)", () => {
    expect(toQueryString({ z: 1, "10": "a", a: 2, "2": "b", m: true })).toBe(
      "2=b&10=a&z=1&a=2&m=true",
    );
    // "01", "-1" and "1.5" are not array-index-like, so they stay where
    // they were written.
    expect(toQueryString({ b: 1, "01": 2, "-1": 3, "1.5": 4, "3": 5 })).toBe(
      "3=5&b=1&01=2&-1=3&1.5=4",
    );
  });
});

describe("createUrlBuilder", () => {
  it.each([
    ["a malformed URL", "not a url"],
    ["an empty string", ""],
    ["a non-http(s) scheme", "ftp://api.example.com"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a base with a query", "http://api.example.com/?v=1"],
    ["a base with a fragment", "http://api.example.com/#top"],
    ["a base with a bare ?", "http://localhost:8080/?"],
    ["a base with a bare #", "http://localhost:8080/#"],
    ["a base path with a bare ?", "https://api.example.com/base?"],
  ])("rejects %s with a TypeError", (_, baseUrl) => {
    expect(() => createUrlBuilder(baseUrl)).toThrow(TypeError);
  });

  it("names the rule a rejected base URL breaks", () => {
    expect(() => createUrlBuilder("ftp://api.example.com")).toThrow(
      "API base URL must be http or https: ftp://api.example.com",
    );
    expect(() => createUrlBuilder("https://api.example.com/?v=1")).toThrow(
      "API base URL must not have a query or a fragment",
    );
    expect(() => createUrlBuilder("http://localhost:8080/?")).toThrow(
      "API base URL must not have a query or a fragment: http://localhost:8080/?",
    );
  });

  it("accepts a percent-encoded ? or # in the path", () => {
    expect(
      createUrlBuilder("http://localhost:8080/a%3Fb%23c/")("/v1/categories"),
    ).toBe("http://localhost:8080/a%3Fb%23c/v1/categories");
  });

  it.each([
    ["http://localhost:8080", "http://localhost:8080/v1/categories"],
    ["http://localhost:8080/", "http://localhost:8080/v1/categories"],
    ["https://api.example.com///", "https://api.example.com/v1/categories"],
    [
      "https://api.example.com/base",
      "https://api.example.com/base/v1/categories",
    ],
    [
      "https://api.example.com/base/",
      "https://api.example.com/base/v1/categories",
    ],
  ])("joins %s and a path without a double slash", (baseUrl, expected) => {
    expect(createUrlBuilder(baseUrl)("/v1/categories")).toBe(expected);
  });

  it("rejects a path without a leading slash", () => {
    const urlFor = createUrlBuilder("http://localhost:8080");

    expect(() => urlFor("v1/categories")).toThrow(
      'API path must start with "/": v1/categories',
    );
    expect(() => urlFor("")).toThrow(TypeError);
  });

  it("returns a builder that can be called many times", () => {
    const urlFor = createUrlBuilder("http://localhost:8080/");

    expect(urlFor("/v1/categories")).toBe(
      "http://localhost:8080/v1/categories",
    );
    expect(urlFor("/v1/products")).toBe("http://localhost:8080/v1/products");
  });

  it("adds a query string only when the query is not empty", () => {
    const urlFor = createUrlBuilder("http://localhost:8080");

    expect(urlFor("/v1/products", {})).toBe(
      "http://localhost:8080/v1/products",
    );
    expect(urlFor("/v1/products", { cursor: null, q: undefined })).toBe(
      "http://localhost:8080/v1/products",
    );
    expect(urlFor("/v1/products", { category: "kaos", limit: 20 })).toBe(
      "http://localhost:8080/v1/products?category=kaos&limit=20",
    );
    expect(urlFor("/v1/products", { page: 0 })).toBe(
      "http://localhost:8080/v1/products?page=0",
    );
  });
});
