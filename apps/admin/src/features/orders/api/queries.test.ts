import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api.ts";
import { orderSummary } from "@/test/fixtures.ts";
import { orderListResponse, orderQueueHandler } from "@/test/msw/orders.ts";
import { recordRequests } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import {
  QUEUE_PAGE_SIZE,
  adminOrderQuery,
  invalidateOrderQueries,
  orderKeys,
  orderQueueQuery,
} from "./queries.ts";

describe("orderKeys", () => {
  it("puts every key under one prefix", () => {
    expect(orderKeys.all).toEqual(["admin", "orders"]);
    expect(orderKeys.queues).toEqual(["admin", "orders", "queue"]);
    expect(orderKeys.queue("shipped")).toEqual([
      "admin",
      "orders",
      "queue",
      "shipped",
    ]);
    expect(orderKeys.details).toEqual(["admin", "orders", "detail"]);
    expect(orderKeys.detail("o-1")).toEqual([
      "admin",
      "orders",
      "detail",
      "o-1",
    ]);
  });
});

describe("orderQueueQuery", () => {
  it("asks for one status, a page at a time, with the previous page's cursor", async () => {
    const sent = recordRequests();
    server.use(
      orderQueueHandler((request) =>
        new URL(request.url).searchParams.get("cursor") === null
          ? orderListResponse([orderSummary(1)], "c2")
          : orderListResponse([orderSummary(2)], null),
      ),
    );
    const client = new QueryClient();
    const options = orderQueueQuery(api, "processing");

    const data = await client.infiniteQuery({ ...options, pages: 2 });

    expect(options.queryKey).toEqual(orderKeys.queue("processing"));
    expect(data.pages.map((page) => page.data[0]?.id)).toEqual([
      orderSummary(1).id,
      orderSummary(2).id,
    ]);
    expect(sent.map((request) => request.url.search)).toEqual([
      `?status=processing&limit=${String(QUEUE_PAGE_SIZE)}`,
      `?status=processing&cursor=c2&limit=${String(QUEUE_PAGE_SIZE)}`,
    ]);
  });

  it("has no next page when next_cursor is null, and one when it is set", () => {
    const { getNextPageParam } = orderQueueQuery(api, "paid");
    const page = (next: string | null) => ({
      data: [],
      page: { next_cursor: next },
    });

    expect(getNextPageParam(page(null), [], undefined, [])).toBeUndefined();
    expect(getNextPageParam(page("c9"), [], undefined, [])).toBe("c9");
  });
});

describe("adminOrderQuery", () => {
  it("is keyed by the order's ID", () => {
    expect(adminOrderQuery(api, "o-1").queryKey).toEqual(
      orderKeys.detail("o-1"),
    );
  });
});

describe("invalidateOrderQueries", () => {
  const seeded = () => {
    const client = new QueryClient();
    client.setQueryData(orderKeys.queue("paid"), 1);
    client.setQueryData(orderKeys.queue("shipped"), 1);
    client.setQueryData(orderKeys.detail("o-1"), 1);
    client.setQueryData(orderKeys.detail("o-2"), 1);
    client.setQueryData(["admin", "reports"], 1);
    return client;
  };
  const stale = (client: QueryClient) =>
    client
      .getQueryCache()
      .getAll()
      .filter((query) => query.isStale())
      .map((query) => query.queryKey);

  it("marks every order query stale without an order", async () => {
    const client = seeded();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await invalidateOrderQueries(client);

    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: orderKeys.all,
    });
    expect(stale(client)).toHaveLength(4);
    expect(stale(client)).not.toContainEqual(["admin", "reports"]);
  });

  it("marks the queues and that order's detail stale, not other orders", async () => {
    const client = seeded();

    await invalidateOrderQueries(client, "o-1");

    expect(stale(client)).toEqual([
      orderKeys.queue("paid"),
      orderKeys.queue("shipped"),
      orderKeys.detail("o-1"),
    ]);
  });
});
