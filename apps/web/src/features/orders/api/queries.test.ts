import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  order,
  orderDetailResponse,
  orderSummary,
  ordersResponse,
} from "@/test/checkout-fixtures.ts";
import { api, errorResponse, fetchMock, requestUrl } from "@/test/fake-api.ts";
import {
  ORDERS_PAGE_SIZE,
  orderKeys,
  orderQuery,
  ordersQuery,
} from "./queries.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("orderKeys", () => {
  it("puts the user in every key under one prefix", () => {
    expect(orderKeys.all).toEqual(["orders"]);
    expect(orderKeys.user("u1")).toEqual(["orders", "u1"]);
    expect(orderKeys.detail("u1", "o1")).toEqual([
      "orders",
      "u1",
      "detail",
      "o1",
    ]);
    expect(orderKeys.list("u1")).toEqual(["orders", "u1", "list"]);
  });
});

describe("orderQuery", () => {
  it("gets one order by id", async () => {
    fetchMock.mockResolvedValue(orderDetailResponse(order({ id: "o1" })));

    const result = await client().query(orderQuery(api, "u1", "o1"));

    expect(result.id).toBe("o1");
    expect(orderQuery(api, "u1", "o1").queryKey).toEqual(
      orderKeys.detail("u1", "o1"),
    );
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(input && requestUrl(input).pathname).toBe("/v1/orders/o1");
  });

  it("throws the API's NOT_FOUND for an order that is not the buyer's", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "NOT_FOUND"));

    await expect(
      client().query(orderQuery(api, "u1", "someone-elses")),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("ordersQuery", () => {
  it("asks ten at a time and follows next_cursor until it is null", async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        requestUrl(input).searchParams.get("cursor") === "c2"
          ? ordersResponse([orderSummary("b")], null)
          : ordersResponse([orderSummary("a")], "c2"),
      ),
    );
    const queryClient = client();
    const options = ordersQuery(api, "u1");

    const first = await queryClient.infiniteQuery(options);
    const [firstPage] = first.pages;
    expect(
      firstPage &&
        options.getNextPageParam(firstPage, first.pages, null, [null]),
    ).toBe("c2");
    const both = await queryClient.infiniteQuery({ ...options, pages: 2 });

    expect(both.pages.flatMap((page) => page.data.map((o) => o.id))).toEqual([
      "a",
      "b",
    ]);
    const urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
    expect(urls[0]?.searchParams.get("limit")).toBe(String(ORDERS_PAGE_SIZE));
    expect(urls[0]?.searchParams.has("cursor")).toBe(false);
    expect(urls.at(-1)?.searchParams.get("cursor")).toBe("c2");
    const [, lastPage] = both.pages;
    expect(
      lastPage &&
        options.getNextPageParam(lastPage, both.pages, "c2", [null, "c2"]),
    ).toBeNull();
    expect(options.staleTime).toBe(0);
    expect(ORDERS_PAGE_SIZE).toBe(10);
  });
});
