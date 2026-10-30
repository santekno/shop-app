import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { deferred } from "@/test/deferred.ts";
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

  it("marks every order query stale without an order, cancelling nothing", async () => {
    const client = seeded();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await invalidateOrderQueries(client);

    expect(invalidate).toHaveBeenCalledExactlyOnceWith(
      { queryKey: orderKeys.all },
      { cancelRefetch: false },
    );
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

// The race fix (artikel 15): a fetch already running when the invalidation
// arrives is not cancelled; it finishes, and its query is fetched once
// more after it, so what is on screen is from after the event.
describe("invalidateOrderQueries with a fetch on its way", () => {
  /** A query function whose answers the test hands out one at a time. */
  const controlledFetches = () => {
    const calls: {
      signal: AbortSignal;
      answer: ReturnType<typeof deferred<number>>;
    }[] = [];
    const queryFn = ({ signal }: { signal: AbortSignal }) => {
      const answer = deferred<number>();
      calls.push({ signal, answer });
      return answer.promise;
    };
    return { calls, queryFn };
  };

  it("lets the running fetch finish, then fetches again, and resolves after that", async () => {
    const client = new QueryClient();
    const { calls, queryFn } = controlledFetches();
    const observer = new QueryObserver(client, {
      queryKey: orderKeys.detail("o-1"),
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    let settled = false;

    const done = invalidateOrderQueries(client).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(calls[0]?.signal.aborted).toBe(false);
    expect(calls).toHaveLength(1);

    calls[0]?.answer.resolve(1);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(settled).toBe(false);
    calls[1]?.answer.resolve(2);
    await done;

    expect(client.getQueryData(orderKeys.detail("o-1"))).toBe(2);
    unsubscribe();
  });

  it("does not fetch an inactive running query again", async () => {
    const client = new QueryClient();
    const { calls, queryFn } = controlledFetches();
    const running = client.query({
      queryKey: orderKeys.detail("o-9"),
      queryFn,
    });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    const done = invalidateOrderQueries(client);
    calls[0]?.answer.resolve(1);
    await running;
    await done;

    expect(calls).toHaveLength(1);
  });

  it("keeps a next page on its way, then refetches every page", async () => {
    const client = new QueryClient();
    const pageCalls: (string | undefined)[] = [];
    const answers: ReturnType<
      typeof deferred<{ data: string; next: string | null }>
    >[] = [];
    const observer = new InfiniteQueryObserver(client, {
      queryKey: orderKeys.queue("paid"),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
        pageCalls.push(pageParam);
        const answer = deferred<{ data: string; next: string | null }>();
        answers.push(answer);
        return answer.promise;
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: { data: string; next: string | null }) =>
        last.next ?? undefined,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    answers[0]?.resolve({ data: "p1", next: "c2" });
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().hasNextPage).toBe(true);
    });

    const nextPage = observer.fetchNextPage();
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    const done = invalidateOrderQueries(client);
    answers[1]?.resolve({ data: "p2", next: null });
    await nextPage;
    expect(observer.getCurrentResult().data?.pages.map((p) => p.data)).toEqual([
      "p1",
      "p2",
    ]);

    // The refetch after it reloads both pages, from the first.
    await vi.waitFor(() => {
      expect(answers).toHaveLength(3);
    });
    answers[2]?.resolve({ data: "p1b", next: "c2" });
    await vi.waitFor(() => {
      expect(answers).toHaveLength(4);
    });
    answers[3]?.resolve({ data: "p2b", next: null });
    await done;

    expect(pageCalls).toEqual([undefined, "c2", undefined, "c2"]);
    expect(observer.getCurrentResult().data?.pages.map((p) => p.data)).toEqual([
      "p1b",
      "p2b",
    ]);
    unsubscribe();
  });

  it("joins a refetch already running, then refetches once more", async () => {
    const client = new QueryClient();
    const { calls, queryFn } = controlledFetches();
    const observer = new QueryObserver(client, {
      queryKey: orderKeys.queue("paid"),
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    calls[0]?.answer.resolve(1);
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toBe(1);
    });
    void observer.refetch();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });

    const done = invalidateOrderQueries(client, "o-1");
    calls[1]?.answer.resolve(2);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(3);
    });
    expect(calls[1]?.signal.aborted).toBe(false);
    calls[2]?.answer.resolve(3);
    await done;

    expect(calls).toHaveLength(3);
    expect(observer.getCurrentResult().data).toBe(3);
    unsubscribe();
  });
});
