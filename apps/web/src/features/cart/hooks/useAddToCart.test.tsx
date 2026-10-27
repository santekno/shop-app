import { EMPTY_CART, isApiError } from "@goshop/shared";
import type { Cart } from "@goshop/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/features/auth/SessionProvider.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import {
  cartLine,
  cartOf,
  cartResponse,
  deferred,
  detailedErrorResponse,
  errorResponse,
  fetchMock,
  noContentResponse,
  requestUrl,
  user,
  webSessionResponse,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import { selectCartToken, useCartStore } from "../cart-store.ts";
import { forgetUserCarts } from "../merge-guest-cart.ts";
import { useAddToCart } from "./useAddToCart.ts";
import { useCart } from "./useCart.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const PRICE = { amount: 89_000, currency: "IDR" } as const;
const add = (quantity = 1, variantId = "m") => ({
  item: { variant_id: variantId, quantity },
  unitPrice: PRICE,
});

/**
 * The hook under test, with the token it shares the provider with and the
 * cart the header shows (useCart), as on the product page.
 */
const setup = () => {
  const queryClient = createTestQueryClient();
  // Every count the header showed, render by render.
  const seen: (number | undefined)[] = [];
  const hook = renderHook(
    () => {
      const cart = useCart();
      seen.push(cart.data?.item_count);
      return {
        add: useAddToCart(),
        token: useCartStore(selectCartToken),
        cart,
      };
    },
    { wrapper: hookWrapper(queryClient) },
  );
  const cartAt = (token: string | null) =>
    queryClient.getQueryData<Cart>(["cart", token]);
  return { ...hook, queryClient, cartAt, seen };
};

/** POST answers `posted` (with `newToken`), GET answers `fetched`. */
const serveCart = (posted: Cart, fetched: Cart, newToken?: string) => {
  fetchMock.mockImplementation((_input, init) =>
    Promise.resolve(
      init?.method === "POST"
        ? cartResponse(posted, newToken, newToken === undefined ? 200 : 201)
        : cartResponse(fetched),
    ),
  );
};

/** The requests sent, as "METHOD /path". */
const requests = () =>
  fetchMock.mock.calls.map(
    ([input, init]) => `${init?.method ?? "GET"} ${requestUrl(input).pathname}`,
  );

/** Every request waits for the test to answer it, in order. */
const answerLater = () => {
  const answers: ReturnType<typeof deferred<Response>>[] = [];
  fetchMock.mockImplementation(() => {
    const answer = deferred<Response>();
    answers.push(answer);
    return answer.promise;
  });
  return (n: number, response: Response) => {
    const answer = answers[n];
    if (!answer) throw new Error(`request ${n} was not sent`);
    answer.resolve(response);
  };
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useAddToCart", () => {
  it("sends the item as it is, with no token for a guest without a cart", async () => {
    const cart = cartOf([cartLine("m", { quantity: 2 })]);
    serveCart(cart, cart, "tok");
    const { result } = setup();

    act(() => {
      result.current.add.mutate(add(2));
    });
    await waitFor(() => {
      expect(result.current.add.isSuccess).toBe(true);
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.body).toBe('{"variant_id":"m","quantity":2}');
    expect(new Headers(init?.headers).has("X-Cart-Token")).toBe(false);
  });

  it("shows the guess at once: the count and the subtotal go up before the answer", async () => {
    const answer = answerLater();
    const { result, cartAt } = setup();

    act(() => {
      result.current.add.mutate(add(3));
    });

    await waitFor(() => {
      expect(cartAt(null)).toMatchObject({
        item_count: 3,
        subtotal: { amount: 3 * 89_000 },
      });
    });
    expect(result.current.add.isPending).toBe(true);
    answer(
      0,
      cartResponse(cartOf([cartLine("m", { quantity: 3 })]), "tok", 201),
    );
    await waitFor(() => {
      expect(result.current.add.isSuccess).toBe(true);
    });
  });

  it("keeps a new cart's token, storing its cart under the new key first", async () => {
    const serverCart = cartOf([cartLine("m", { quantity: 2 })]);
    serveCart(serverCart, serverCart, "tok-new");
    const { result, cartAt, seen } = setup();
    expect(result.current.token).toBeNull();

    act(() => {
      result.current.add.mutate(add(2));
    });
    await waitFor(() => {
      expect(result.current.token).toBe("tok-new");
    });

    expect(result.current.cart.data).toEqual(serverCart);
    expect(cartAt("tok-new")).toEqual(serverCart);
    expect(cartAt(null)).toEqual(EMPTY_CART);
    // The cart under the new key was there when the header switched to it:
    // from the guess on, the count never went back to nothing.
    const fromGuess = seen.slice(seen.indexOf(2));
    expect(fromGuess.every((count) => count === 2)).toBe(true);
    // The last add of the burst refetches the cart in the background.
    await waitFor(() => {
      expect(requests()).toEqual(["POST /v1/cart/items", "GET /v1/cart"]);
    });
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-Cart-Token"),
    ).toBe("tok-new");
  });

  it("replaces the guess with the server's cart for an existing cart", async () => {
    const before = cartOf([cartLine("m", { quantity: 1 })]);
    const after = cartOf([cartLine("m", { quantity: 3 })]);
    serveCart(after, after);
    const { result, cartAt, queryClient } = setup();
    // Already loaded, so setting the token fetches nothing.
    queryClient.setQueryData(["cart", "tok"], before);
    act(() => {
      useCartStore.getState().setToken("tok");
    });

    act(() => {
      result.current.add.mutate(add(2));
    });
    await waitFor(() => {
      expect(result.current.add.isSuccess).toBe(true);
    });

    expect(cartAt("tok")).toEqual(after);
    expect(result.current.token).toBe("tok");
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-Cart-Token"),
    ).toBe("tok");
    await waitFor(() => {
      expect(requests()).toEqual(["POST /v1/cart/items", "GET /v1/cart"]);
    });
    expect(result.current.cart.data).toEqual(after);
  });

  it("cancels a cart request in flight, so its older answer cannot replace the guess", async () => {
    const before = cartOf([cartLine("m", { quantity: 1 })]);
    const answer = answerLater();
    const { result, cartAt, queryClient } = setup();
    queryClient.setQueryData(["cart", "tok"], before);
    act(() => {
      useCartStore.getState().setToken("tok");
    });
    // A refetch of the cart is on its way (request 0)…
    act(() => {
      void queryClient.refetchQueries({ queryKey: ["cart", "tok"] });
    });
    await waitFor(() => {
      expect(requests()).toEqual(["GET /v1/cart"]);
    });

    // …when the buyer adds (request 1).
    act(() => {
      result.current.add.mutate(add(2));
    });
    await waitFor(() => {
      expect(cartAt("tok")?.item_count).toBe(3);
    });
    answer(0, cartResponse(before));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(cartAt("tok")?.item_count).toBe(3);
    answer(1, cartResponse(cartOf([cartLine("m", { quantity: 3 })])));
    await waitFor(() => {
      expect(result.current.add.isSuccess).toBe(true);
    });
  });

  it("rolls the guess back on a 409, then fetches the cart again", async () => {
    const before = cartOf([cartLine("m", { quantity: 1 })]);
    const answer = answerLater();
    const { result, cartAt, queryClient } = setup();
    // Already loaded, so setting the token fetches nothing.
    queryClient.setQueryData(["cart", "tok"], before);
    act(() => {
      useCartStore.getState().setToken("tok");
    });

    act(() => {
      result.current.add.mutate(add(5));
    });
    await waitFor(() => {
      expect(cartAt("tok")?.item_count).toBe(6);
    });
    answer(
      0,
      detailedErrorResponse(409, "INSUFFICIENT_STOCK", { available: 2 }),
    );

    // The snapshot goes back and the error shows at once, before the cart
    // is fetched again…
    await waitFor(() => {
      expect(result.current.add.isError).toBe(true);
    });
    expect(cartAt("tok")).toEqual(before);
    expect(result.current.cart.data).toEqual(before);
    expect(result.current.add.error).toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });
    // …since the error says the cart differs from what we thought, it is
    // fetched again in the background.
    await waitFor(() => {
      expect(requests()).toEqual(["POST /v1/cart/items", "GET /v1/cart"]);
    });
    const fresh = cartOf([cartLine("m", { quantity: 2 })]);
    answer(1, cartResponse(fresh));
    await waitFor(() => {
      expect(result.current.cart.data).toEqual(fresh);
    });
    expect(result.current.token).toBe("tok");
  });

  it("puts the empty cart back on screen when the first add fails", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR"));
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.cart.data).toEqual(EMPTY_CART);
    });

    act(() => {
      result.current.add.mutate(add(2));
    });
    await waitFor(() => {
      expect(result.current.add.isError).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.cart.data?.item_count).toBe(0);
    });
    expect(result.current.token).toBeNull();
  });

  it("forgets a token the API no longer knows (CART_NOT_FOUND), without refetching", async () => {
    const before = cartOf([cartLine("m")]);
    fetchMock.mockResolvedValue(errorResponse(404, "CART_NOT_FOUND"));
    const { result, cartAt, queryClient } = setup();
    // Already loaded, so setting the token fetches nothing.
    queryClient.setQueryData(["cart", "old"], before);
    act(() => {
      useCartStore.getState().setToken("old");
    });

    act(() => {
      result.current.add.mutate(add(1));
    });
    await waitFor(() => {
      expect(result.current.add.isError).toBe(true);
    });

    expect(result.current.token).toBeNull();
    expect(cartAt("old")).toEqual(before);
    expect(queryClient.getQueryState(["cart", "old"])?.isInvalidated).toBe(
      false,
    );
    expect(requests()).toEqual(["POST /v1/cart/items"]);
  });

  it("never retries the POST", async () => {
    fetchMock.mockResolvedValue(errorResponse(503, "INTERNAL_ERROR"));
    const { result } = setup();

    act(() => {
      result.current.add.mutate(add(1));
    });
    await waitFor(() => {
      expect(result.current.add.isError).toBe(true);
    });

    expect(requests()).toEqual(["POST /v1/cart/items"]);
  });
});

describe("useAddToCart's queue", () => {
  /** Two add buttons (two hook instances) sharing one provider and cache. */
  const setupTwo = () => {
    const queryClient = createTestQueryClient();
    const hook = renderHook(
      () => ({
        first: useAddToCart(),
        second: useAddToCart(),
        token: useCartStore(selectCartToken),
        cart: useCart(),
      }),
      { wrapper: hookWrapper(queryClient) },
    );
    return { ...hook, queryClient };
  };

  const tokenOf = (n: number) =>
    new Headers(fetchMock.mock.calls[n]?.[1]?.headers).get("X-Cart-Token");

  it("runs two adds one after the other, the second with the token the first created", async () => {
    const answer = answerLater();
    const { result } = setupTwo();

    act(() => {
      result.current.first.mutate(add(1, "m"));
      result.current.second.mutate(add(2, "l"));
    });
    await waitFor(() => {
      expect(requests()).toEqual(["POST /v1/cart/items"]);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    // The second waits for the first.
    expect(requests()).toEqual(["POST /v1/cart/items"]);
    expect(tokenOf(0)).toBeNull();

    answer(0, cartResponse(cartOf([cartLine("m")]), "t1", 201));
    await waitFor(() => {
      expect(requests()).toEqual([
        "POST /v1/cart/items",
        "POST /v1/cart/items",
      ]);
    });
    // One guest cart: the second add went to the cart the first created.
    expect(tokenOf(1)).toBe("t1");

    const both = cartOf([cartLine("m"), cartLine("l", { quantity: 2 })]);
    answer(1, cartResponse(both));
    // Refetched once, after the last add of the burst.
    await waitFor(() => {
      expect(requests()).toEqual([
        "POST /v1/cart/items",
        "POST /v1/cart/items",
        "GET /v1/cart",
      ]);
    });
    expect(tokenOf(2)).toBe("t1");
    answer(2, cartResponse(both));
    await waitFor(() => {
      expect(result.current.cart.data).toEqual(both);
    });
    expect(result.current.token).toBe("t1");
  });

  it("rolls a failed add back mid-burst, and the final refetch corrects the cart", async () => {
    const before = cartOf([cartLine("m", { quantity: 1 })]);
    const answer = answerLater();
    const { result, queryClient } = setupTwo();
    queryClient.setQueryData(["cart", "tok"], before);
    act(() => {
      useCartStore.getState().setToken("tok");
    });

    act(() => {
      result.current.first.mutate(add(5, "m"));
      result.current.second.mutate(add(1, "l"));
    });
    // Both guesses show at once: 1 + 5 + 1.
    await waitFor(() => {
      expect(result.current.cart.data?.item_count).toBe(7);
    });
    await waitFor(() => {
      expect(requests()).toEqual(["POST /v1/cart/items"]);
    });
    answer(
      0,
      detailedErrorResponse(409, "INSUFFICIENT_STOCK", { available: 2 }),
    );

    // The failed add puts its snapshot back at once…
    await waitFor(() => {
      expect(result.current.first.isError).toBe(true);
    });
    expect(result.current.cart.data).toEqual(before);
    // …and the queue moves on to the second add, with no refetch between.
    await waitFor(() => {
      expect(requests()).toEqual([
        "POST /v1/cart/items",
        "POST /v1/cart/items",
      ]);
    });

    const afterSecond = cartOf([
      cartLine("m", { quantity: 1 }),
      cartLine("l", { quantity: 1 }),
    ]);
    answer(1, cartResponse(afterSecond));
    await waitFor(() => {
      expect(requests()).toEqual([
        "POST /v1/cart/items",
        "POST /v1/cart/items",
        "GET /v1/cart",
      ]);
    });
    const fresh = cartOf([
      cartLine("m", { quantity: 2 }),
      cartLine("l", { quantity: 1 }),
    ]);
    answer(2, cartResponse(fresh));
    await waitFor(() => {
      expect(result.current.cart.data).toEqual(fresh);
    });
  });

  it("does not refetch after an add that found the cart gone", async () => {
    const answer = answerLater();
    const { result, queryClient } = setupTwo();
    queryClient.setQueryData(["cart", "old"], cartOf([cartLine("m")]));
    act(() => {
      useCartStore.getState().setToken("old");
    });

    act(() => {
      result.current.first.mutate(add(1));
    });
    await waitFor(() => {
      expect(requests()).toEqual(["POST /v1/cart/items"]);
    });
    answer(0, errorResponse(404, "CART_NOT_FOUND"));
    await waitFor(() => {
      expect(result.current.first.isError).toBe(true);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(requests()).toEqual(["POST /v1/cart/items"]);
    expect(result.current.token).toBeNull();
  });
});

describe("useAddToCart and the session", () => {
  const itemRequests = () =>
    fetchMock.mock.calls.filter(
      ([input]) => requestUrl(input).pathname === "/v1/cart/items",
    );

  const renderAdd = (session: Parameters<typeof hookWrapper>[2]) => {
    const queryClient = createTestQueryClient();
    const hook = renderHook(
      () => ({ add: useAddToCart(), token: useCartStore(selectCartToken) }),
      { wrapper: hookWrapper(queryClient, "/", session) },
    );
    return { ...hook, queryClient };
  };

  it("adds to the logged-in user's cart with the access token, never a guest token", async () => {
    useCartStore.getState().setToken("guest-tok");
    const after = cartOf([cartLine("m", { quantity: 2 })]);
    const answer = deferred<Response>();
    fetchMock.mockImplementation((_input, init) =>
      init?.method === "POST"
        ? answer.promise
        : Promise.resolve(cartResponse(after)),
    );
    const { result, queryClient } = renderAdd({
      user: user({ id: "u1" }),
      accessToken: "a",
    });

    act(() => {
      result.current.add.mutate(add(2));
    });
    // The guess goes under the user's key at once.
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Cart>(["cart", "user", "u1"])?.item_count,
      ).toBe(2);
    });
    answer.resolve(cartResponse(after));
    await waitFor(() => {
      expect(result.current.add.isSuccess).toBe(true);
    });

    const headers = new Headers(itemRequests()[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer a");
    expect(headers.has("X-Cart-Token")).toBe(false);
    expect(queryClient.getQueryData(["cart", "user", "u1"])).toEqual(after);
    // The guest token is neither used nor replaced.
    expect(result.current.token).toBe("guest-tok");
    expect(queryClient.getQueryData(["cart", "guest-tok"])).toBeUndefined();
  });

  it("waits for the start-up restore, then adds as the user it found", async () => {
    const refresh = deferred<Response>();
    const after = cartOf([cartLine("m")]);
    fetchMock.mockImplementation((input) =>
      requestUrl(input).pathname === "/v1/auth/web/refresh"
        ? refresh.promise
        : Promise.resolve(cartResponse(after)),
    );
    const { result, queryClient } = renderAdd("restore");

    act(() => {
      result.current.add.mutate(add());
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(itemRequests()).toHaveLength(0);

    refresh.resolve(webSessionResponse(user({ id: "u1" }), "restored"));

    await waitFor(() => {
      expect(result.current.add.isSuccess).toBe(true);
    });
    expect(itemRequests()).toHaveLength(1);
    const headers = new Headers(itemRequests()[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer restored");
    expect(headers.has("X-Cart-Token")).toBe(false);
    // No guest cart was started that nobody would merge.
    expect(result.current.token).toBeNull();
    expect(queryClient.getQueryData(["cart", "user", "u1"])).toEqual(after);
  });
});

describe("useAddToCart when the session ends during an add", () => {
  const USER_KEY = ["cart", "user", "u1"] as const;
  const before = cartOf([cartLine("x")]);
  const after = cartOf([cartLine("x"), cartLine("m")]);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const itemPosts = () =>
    fetchMock.mock.calls.filter(
      ([input, init]) =>
        init?.method === "POST" &&
        requestUrl(input).pathname === "/v1/cart/items",
    );

  /**
   * The hook under the app's providers with the app's onEnd (the user's
   * carts leave the cache), starting from `session` ("restore" asks the
   * fake API with /web/refresh, as the app does).
   */
  const renderAdd = (
    session: Parameters<typeof SessionProvider>[0]["initialSession"],
  ) => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <SessionProvider
          initialSession={session}
          onEnd={() => {
            forgetUserCarts(queryClient);
          }}
        >
          {children}
        </SessionProvider>
      </QueryClientProvider>
    );
    const hook = renderHook(
      () => ({
        add: useAddToCart(),
        session: useSession(),
        token: useCartStore(selectCartToken),
      }),
      { wrapper },
    );
    return { ...hook, queryClient };
  };

  it.each([
    ["no cookie any more (204, logged out in another tab)", noContentResponse],
    [
      "a refused cookie (401, revoked)",
      () => errorResponse(401, "TOKEN_INVALID"),
    ],
  ])(
    "fails with UNAUTHORIZED, sends no guest add and writes nothing back under the user's key, after %s",
    async (_name, refreshAnswer) => {
      // Date.now is read by the session manager created at mount.
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      let refreshes = 0;
      fetchMock.mockImplementation((input, init) => {
        const path = requestUrl(input).pathname;
        if (path === "/v1/auth/web/refresh") {
          refreshes += 1;
          return Promise.resolve(
            refreshes === 1
              ? webSessionResponse(user({ id: "u1" }), "restored", 60)
              : refreshAnswer(),
          );
        }
        // Sent without a token, the API would start an orphan guest cart.
        return Promise.resolve(
          init?.method === "POST"
            ? cartResponse(after, "orphan-guest-token", 201)
            : cartResponse(EMPTY_CART),
        );
      });
      const { result, queryClient } = renderAdd(undefined);
      await waitFor(() => {
        expect(result.current.session.status).toBe("authenticated");
      });
      queryClient.setQueryData(USER_KEY, before);
      // Past the moment to replace the 60 s token (30 s before it ends).
      clock.mockReturnValue(1_000_000 + 45_000);

      act(() => {
        result.current.add.mutate(add());
      });
      await waitFor(() => {
        expect(result.current.add.isError).toBe(true);
      });

      expect(isApiError(result.current.add.error, "UNAUTHORIZED")).toBe(true);
      expect(result.current.add.error).toMatchObject({ status: 401 });
      expect(itemPosts()).toHaveLength(0);
      expect(refreshes).toBe(2);
      expect(result.current.session.status).toBe("anonymous");
      // Neither the rollback nor the guess brought the user's cart back.
      expect(queryClient.getQueryData(USER_KEY)).toBeUndefined();
      // No guest cart token was kept from a guest add.
      expect(result.current.token).toBeNull();
    },
  );

  it("does not write a late answer under the user's key once the session has ended", async () => {
    const answer = deferred<Response>();
    fetchMock.mockImplementation((_input, init) =>
      init?.method === "POST"
        ? answer.promise
        : Promise.resolve(cartResponse(EMPTY_CART)),
    );
    const { result, queryClient } = renderAdd({
      user: user({ id: "u1" }),
      accessToken: "a",
    });
    queryClient.setQueryData(USER_KEY, before);

    act(() => {
      result.current.add.mutate(add());
    });
    await waitFor(() => {
      expect(itemPosts()).toHaveLength(1);
    });
    // The session ends while the add is on its way: what onEnd does.
    act(() => {
      result.current.session.setSession(null);
    });
    forgetUserCarts(queryClient);
    answer.resolve(cartResponse(after));
    await waitFor(() => {
      expect(result.current.add.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData(USER_KEY)).toBeUndefined();
    expect(result.current.token).toBeNull();
  });

  it("refuses a logged-in add the API answered as a guest's (with a cart_token)", async () => {
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === "POST"
          ? cartResponse(after, "orphan-guest-token", 201)
          : cartResponse(before),
      ),
    );
    const { result, queryClient } = renderAdd({
      user: user({ id: "u1" }),
      accessToken: "a",
    });
    queryClient.setQueryData(USER_KEY, before);

    act(() => {
      result.current.add.mutate(add());
    });
    await waitFor(() => {
      expect(result.current.add.isError).toBe(true);
    });

    expect(isApiError(result.current.add.error, "UNAUTHORIZED")).toBe(true);
    // The guess was rolled back (the user is still logged in here) and the
    // answer's cart was not stored as the user's.
    expect(queryClient.getQueryData(USER_KEY)).toEqual(before);
    // The orphan token is neither kept nor used as a key.
    expect(result.current.token).toBeNull();
    expect(
      queryClient.getQueryData(["cart", "orphan-guest-token"]),
    ).toBeUndefined();
  });
});
