import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STALE_TIME_MS,
  createQueryClient,
  getQueryClient,
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

describe("getQueryClient", () => {
  it("gives the browser one client for the whole visit, with the same defaults", () => {
    const client = getQueryClient();

    expect(client).toBeInstanceOf(QueryClient);
    expect(getQueryClient()).toBe(client);
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
  });

  it("gives the server a new client every time, so no visitor sees another's cache", () => {
    // On the server there is no window. Put back at once: the shared
    // afterEach (vitest.setup.ts) needs it.
    vi.stubGlobal("window", undefined);
    const a = getQueryClient();
    const b = getQueryClient();
    vi.unstubAllGlobals();

    expect(a).toBeInstanceOf(QueryClient);
    expect(a).not.toBe(b);
  });
});
