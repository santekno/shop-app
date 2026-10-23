import { describe, expect, it } from "vitest";
import { createUrlBuilder } from "./url.ts";

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
});
