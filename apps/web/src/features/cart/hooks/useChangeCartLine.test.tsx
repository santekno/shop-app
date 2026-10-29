import { isApiError } from "@goshop/shared";
import type { Cart } from "@goshop/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/features/auth/session-context.ts";
import { jsonBody } from "@/test/checkout-fixtures.ts";
import {
  cartLine,
  cartOf,
  cartResponse,
  deferred,
  detailedErrorResponse,
  fetchMock,
  requestUrl,
  user,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import type { TestSession } from "@/test/render.tsx";
import { useCartStore } from "../cart-store.ts";
import { LINE_MAX_QUANTITY, useChangeCartLine } from "./useChangeCartLine.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const USER_KEY = ["cart", "user", "u1"];
const GUEST_KEY = ["cart", "tok"];

/** The line requests sent, as "METHOD /path" with the body. */
const lineRequests = () =>
  fetchMock.mock.calls
    .filter(([input]) =>
      requestUrl(input).pathname.startsWith("/v1/cart/items/"),
    )
    .map(([input, init]) => ({
      request: `${init?.method ?? "GET"} ${requestUrl(input).pathname}`,
      body: jsonBody(init),
      headers: new Headers(init?.headers),
    }));

/** Every line request waits for the test; GET answers `cart` at once. */
const answerLater = (cart: () => Cart) => {
  const answers: ReturnType<typeof deferred<Response>>[] = [];
  fetchMock.mockImplementation((_input, init) => {
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve(cartResponse(cart()));
    }
    const answer = deferred<Response>();
    answers.push(answer);
    return answer.promise;
  });
  return (n: number, response: Response) => {
    const answer = answers[n];
    if (!answer) throw new Error(`request ${String(n)} was not sent`);
    answer.resolve(response);
  };
};

const setup = (session: TestSession, key: string[], cart?: Cart) => {
  const queryClient = createTestQueryClient();
  if (cart !== undefined) queryClient.setQueryData(key, cart);
  const hook = renderHook(
    () => ({ line: useChangeCartLine(), session: useSession() }),
    { wrapper: hookWrapper(queryClient, "/keranjang", session) },
  );
  return {
    ...hook,
    queryClient,
    cached: () => queryClient.getQueryData<Cart>(key),
  };
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useChangeCartLine", () => {
  it("changes a logged-in buyer's line with the access token, never a guest token", async () => {
    useCartStore.getState().setToken("guest-tok");
    const after = cartOf([cartLine("m", { quantity: 4 })]);
    const answer = answerLater(() => after);
    const { result, cached } = setup(
      { user: user({ id: "u1" }), accessToken: "a" },
      USER_KEY,
      cartOf([cartLine("m", { quantity: 2 })]),
    );

    act(() => {
      result.current.line.change({
        kind: "quantity",
        variantId: "m",
        quantity: 4,
      });
    });
    expect(cached()?.item_count).toBe(4);
    await waitFor(() => {
      expect(lineRequests()).toHaveLength(1);
    });
    answer(0, cartResponse(after));
    await waitFor(() => {
      expect(result.current.line.isSuccess).toBe(true);
    });

    const [sent] = lineRequests();
    expect(sent?.request).toBe("PATCH /v1/cart/items/m");
    expect(sent?.body).toEqual({ quantity: 4 });
    expect(sent?.headers.get("Authorization")).toBe("Bearer a");
    expect(sent?.headers.has("X-Cart-Token")).toBe(false);
    expect(cached()).toEqual(after);
    expect(result.current.line.lastChange).toEqual({
      kind: "quantity",
      variantId: "m",
      quantity: 4,
    });
  });

  it("counts quick presses from each other, sending them one after another", async () => {
    useCartStore.getState().setToken("tok");
    const answer = answerLater(() => cartOf([cartLine("m", { quantity: 4 })]));
    const { result, cached } = setup(
      null,
      GUEST_KEY,
      cartOf([cartLine("m", { quantity: 1 })]),
    );

    act(() => {
      result.current.line.change({ kind: "step", variantId: "m", delta: 1 });
      result.current.line.change({ kind: "step", variantId: "m", delta: 1 });
      result.current.line.change({ kind: "step", variantId: "m", delta: 1 });
    });
    expect(cached()?.lines[0]?.quantity).toBe(4);

    for (const [n, quantity] of [2, 3, 4].entries()) {
      await waitFor(() => {
        expect(lineRequests()).toHaveLength(n + 1);
      });
      // One at a time: the next is not sent before this one is answered.
      expect(lineRequests()[n]?.body).toEqual({ quantity });
      answer(n, cartResponse(cartOf([cartLine("m", { quantity })])));
    }
    await waitFor(() => {
      expect(cached()?.lines[0]?.quantity).toBe(4);
    });
    expect(lineRequests().map((r) => r.headers.get("X-Cart-Token"))).toEqual([
      "tok",
      "tok",
      "tok",
    ]);
  });

  it("puts the click's snapshot back when the API refuses the quantity", async () => {
    useCartStore.getState().setToken("tok");
    const before = cartOf([cartLine("m", { quantity: 2 })]);
    const answer = answerLater(() => before);
    const { result, cached } = setup(null, GUEST_KEY, before);

    act(() => {
      result.current.line.change({ kind: "step", variantId: "m", delta: 1 });
    });
    expect(cached()?.lines[0]?.quantity).toBe(3);
    await waitFor(() => {
      expect(lineRequests()).toHaveLength(1);
    });
    answer(
      0,
      detailedErrorResponse(409, "INSUFFICIENT_STOCK", { available: 2 }),
    );

    await waitFor(() => {
      expect(result.current.line.isError).toBe(true);
    });
    expect(cached()).toEqual(before);
  });

  it("removes without a guess: the line stays in the cache until the API answers", async () => {
    useCartStore.getState().setToken("tok");
    const before = cartOf([cartLine("m"), cartLine("l")]);
    const answer = answerLater(() => before);
    const { result, cached } = setup(null, GUEST_KEY, before);

    act(() => {
      result.current.line.change({ kind: "remove", variantId: "m" });
    });
    await waitFor(() => {
      expect(lineRequests()[0]?.request).toBe("DELETE /v1/cart/items/m");
    });
    expect(cached()).toBe(before);

    const after = cartOf([cartLine("l")]);
    answer(0, cartResponse(after));
    await waitFor(() => {
      expect(cached()).toEqual(after);
    });
  });

  it.each([
    ["below 1", 1, -1],
    [`above ${String(LINE_MAX_QUANTITY)}`, LINE_MAX_QUANTITY, 1],
  ] as const)("sends nothing for a step %s", (_, quantity, delta) => {
    useCartStore.getState().setToken("tok");
    const before = cartOf([cartLine("m", { quantity })]);
    const { result, cached } = setup(null, GUEST_KEY, before);

    act(() => {
      result.current.line.change({ kind: "step", variantId: "m", delta });
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cached()).toBe(before);
  });

  it("sends nothing for a step on a line that is not in the cache", () => {
    useCartStore.getState().setToken("tok");
    const { result } = setup(null, GUEST_KEY, cartOf([cartLine("m")]));

    act(() => {
      result.current.line.change({ kind: "step", variantId: "x", delta: 1 });
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a change queued by a buyer whose session ended before it was sent", async () => {
    const before = cartOf([cartLine("m", { quantity: 2 })]);
    const answer = answerLater(() => before);
    const { result, cached } = setup(
      { user: user({ id: "u1" }), accessToken: "a" },
      USER_KEY,
      before,
    );

    // Both clicks are made while logged in; the second waits for the first.
    act(() => {
      result.current.line.change({ kind: "remove", variantId: "m" });
    });
    await waitFor(() => {
      expect(lineRequests()).toHaveLength(1);
    });
    act(() => {
      result.current.line.change({
        kind: "quantity",
        variantId: "m",
        quantity: 5,
      });
    });
    act(() => {
      result.current.session.setSession(null);
    });
    answer(0, cartResponse(cartOf([])));

    await waitFor(() => {
      expect(result.current.line.isError).toBe(true);
    });
    expect(isApiError(result.current.line.error, "UNAUTHORIZED")).toBe(true);
    // Never sent as a guest's change.
    expect(lineRequests()).toHaveLength(1);
    // Nothing written under the ended session's key: not the removal's
    // answer, not the rollback.
    expect(cached()?.lines[0]?.quantity).toBe(5);
  });
});
