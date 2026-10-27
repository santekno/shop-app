import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_TIME_MS,
  createQueryClient,
  queryClient,
} from "./query-client.ts";

describe("createQueryClient", () => {
  it("leaves retrying to the API client and keeps data fresh for 30 s", () => {
    const { queries, mutations } = createQueryClient().getDefaultOptions();

    expect(queries?.retry).toBe(false);
    expect(queries?.staleTime).toBe(30_000);
    expect(DEFAULT_STALE_TIME_MS).toBe(30_000);
    // Mutations keep TanStack's default: never retried.
    expect(mutations?.retry).toBeUndefined();
  });

  it("gives every call a client of its own", () => {
    const a = createQueryClient();
    const b = createQueryClient();

    expect(a).toBeInstanceOf(QueryClient);
    expect(a).not.toBe(b);
    expect(a.getQueryCache()).not.toBe(b.getQueryCache());
  });

  it("does not retry a failed query", async () => {
    const client = createQueryClient();
    let calls = 0;

    await client
      .query({
        queryKey: ["fails"],
        queryFn: () => {
          calls++;
          return Promise.reject(new Error("down"));
        },
      })
      .catch(() => undefined);

    expect(calls).toBe(1);
  });

  it("serves a fresh cached copy without fetching again", async () => {
    const client = createQueryClient();
    let calls = 0;
    const options = {
      queryKey: ["fresh"],
      queryFn: () => Promise.resolve(++calls),
    };

    await client.query(options);
    await client.query(options);

    expect(calls).toBe(1);
  });
});

describe("queryClient", () => {
  it("is the storefront's client, with the same defaults", () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });
});
