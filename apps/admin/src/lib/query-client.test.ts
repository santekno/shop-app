import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_TIME_MS,
  createQueryClient,
  queryClient,
} from "./query-client.ts";

describe("createQueryClient", () => {
  it("never retries a query itself and keeps data fresh for 10 seconds", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions().queries;

    expect(defaults?.retry).toBe(false);
    expect(defaults?.staleTime).toBe(10_000);
    expect(DEFAULT_STALE_TIME_MS).toBe(10_000);
  });

  it("gives every call a client with a cache of its own", () => {
    const first = createQueryClient();
    const second = createQueryClient();
    first.setQueryData(["x"], 1);

    expect(second).not.toBe(first);
    expect(second.getQueryData(["x"])).toBeUndefined();
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });
});
