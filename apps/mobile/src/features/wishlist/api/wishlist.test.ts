import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { apiError, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { SignInRequiredError } from "../messages";
import {
  WISHLIST_PAGE_SIZE,
  addToWishlist,
  fetchWishlistPage,
  fetchWishlistSlugs,
  removeFromWishlist,
} from "./wishlist";

jest.mock("../auth-seam", () => ({
  getAccessToken: jest.fn(() => null),
}));
import { getAccessToken } from "../auth-seam";

const token = (value: string | null) => {
  jest.mocked(getAccessToken).mockReturnValue(value);
};

afterEach(() => {
  token(null);
});

describe("the wishlist requests, signed out", () => {
  it("send nothing and throw SignInRequiredError", async () => {
    await expect(async () => fetchWishlistPage(null)).rejects.toBeInstanceOf(
      SignInRequiredError,
    );
    await expect(fetchWishlistSlugs()).rejects.toBeInstanceOf(
      SignInRequiredError,
    );
    await expect(addToWishlist("kaos")).rejects.toBeInstanceOf(
      SignInRequiredError,
    );
    await expect(removeFromWishlist("kaos")).rejects.toBeInstanceOf(
      SignInRequiredError,
    );
    expect(fakeApi.requests()).toHaveLength(0);
  });
});

describe("the wishlist requests, signed in", () => {
  it("fetchWishlistPage sends the bearer token, the cursor and the limit", async () => {
    token("tok-123");
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage([product("Kaos")], "c2")),
    );

    const page = await fetchWishlistPage("c1", undefined, 50);

    expect(page.page.next_cursor).toBe("c2");
    const [request] = fakeApi.requests("GET", "/v1/me/wishlist");
    expect(request?.url.searchParams.get("cursor")).toBe("c1");
    expect(request?.url.searchParams.get("limit")).toBe("50");
    expect(new Headers(request?.init.headers).get("Authorization")).toBe(
      "Bearer tok-123",
    );
  });

  it("fetchWishlistPage asks for 20 and no cursor by default", async () => {
    token("t");
    fakeApi.on("GET", "/v1/me/wishlist", () => json(productPage([])));

    await fetchWishlistPage(null);

    const [request] = fakeApi.requests("GET", "/v1/me/wishlist");
    expect(request?.url.searchParams.get("limit")).toBe("20");
    expect(request?.url.searchParams.has("cursor")).toBe(false);
  });

  it("fetchWishlistSlugs pages through at 100 a page and keeps the slugs in order", async () => {
    token("t");
    expect(WISHLIST_PAGE_SIZE).toBe(100);
    fakeApi.on("GET", "/v1/me/wishlist", ({ url }) =>
      url.searchParams.get("cursor") === null
        ? json(productPage([product("Satu"), product("Dua")], "c1"))
        : json(productPage([product("Tiga")], null)),
    );

    await expect(fetchWishlistSlugs()).resolves.toEqual([
      "satu",
      "dua",
      "tiga",
    ]);

    const requests = fakeApi.requests("GET", "/v1/me/wishlist");
    expect(requests.map((r) => r.url.searchParams.get("limit"))).toEqual([
      "100",
      "100",
    ]);
  });

  it("fetchWishlistSlugs stops after three pages even if the server keeps offering more", async () => {
    token("t");
    fakeApi.on("GET", "/v1/me/wishlist", ({ url }) =>
      json(
        productPage(
          [product(`P${url.searchParams.get("cursor") ?? "0"}`)],
          `c${Math.random()}`,
        ),
      ),
    );

    const slugs = await fetchWishlistSlugs();

    expect(slugs).toHaveLength(3);
    expect(fakeApi.requests("GET", "/v1/me/wishlist")).toHaveLength(3);
  });

  it("addToWishlist is PUT /v1/me/wishlist/{slug} with the token", async () => {
    token("tok");
    fakeApi.on(
      "PUT",
      "/v1/me/wishlist/kaos-polos",
      () => new Response(null, { status: 204 }),
    );

    await addToWishlist("kaos-polos");

    const [request] = fakeApi.requests("PUT", "/v1/me/wishlist/kaos-polos");
    expect(new Headers(request?.init.headers).get("Authorization")).toBe(
      "Bearer tok",
    );
  });

  it("removeFromWishlist is DELETE /v1/me/wishlist/{slug}, with the slug encoded", async () => {
    token("tok");
    fakeApi.on(
      "DELETE",
      "/v1/me/wishlist/a%20b",
      () => new Response(null, { status: 204 }),
    );

    await removeFromWishlist("a b");

    expect(fakeApi.requests("DELETE")).toHaveLength(1);
  });

  it("a 409 from the server rejects with its code", async () => {
    token("tok");
    fakeApi.on("PUT", "/v1/me/wishlist/x", () =>
      apiError(409, "WISHLIST_LIMIT_REACHED"),
    );

    await expect(addToWishlist("x")).rejects.toMatchObject({
      status: 409,
      code: "WISHLIST_LIMIT_REACHED",
    });
  });
});
