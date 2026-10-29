import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "./query-client.ts";
import { ServerDataBoundary } from "./server-data-boundary.tsx";

const catalogKey = ["products", "list", {}];
const productKey = ["products", "detail", "kaos"];

/** What a server page would dehydrate: its own client, its own fetch. */
const serverState = (fill: (client: QueryClient) => void) => {
  const server = createQueryClient();
  fill(server);
  return dehydrate(server);
};

const mount = (browser: QueryClient, state: ReturnType<typeof dehydrate>) =>
  render(
    <QueryClientProvider client={browser}>
      <ServerDataBoundary state={state}>
        <p>catalog</p>
      </ServerDataBoundary>
    </QueryClientProvider>,
  );

describe("ServerDataBoundary", () => {
  it("hands the browser the server's queries on a first load", () => {
    const browser = createQueryClient();

    const { getByText } = mount(
      browser,
      serverState((server) => {
        server.setQueryData(catalogKey, { pages: [["p1"]], pageParams: [""] });
        server.setQueryData(productKey, { name: "Kaos" });
      }),
    );

    expect(getByText("catalog")).toBeDefined();
    expect(browser.getQueryData(catalogKey)).toEqual({
      pages: [["p1"]],
      pageParams: [""],
    });
    expect(browser.getQueryData(productKey)).toEqual({ name: "Kaos" });
  });

  // The bug a plain HydrationBoundary has: the server's page 1 is newer
  // than the browser's three pages, and replaces them.
  it("keeps the pages the browser already loaded, and fills in the rest", () => {
    const browser = createQueryClient();
    const loaded = {
      pages: [["p1"], ["p2"], ["p3"]],
      pageParams: ["", "c2", "c3"],
    };
    browser.setQueryData(catalogKey, loaded, { updatedAt: 1 });

    mount(
      browser,
      serverState((server) => {
        server.setQueryData(
          catalogKey,
          { pages: [["p1 again"]], pageParams: [""] },
          { updatedAt: Date.now() },
        );
        server.setQueryData(productKey, { name: "Kaos" });
      }),
    );

    expect(browser.getQueryData(catalogKey)).toBe(loaded);
    expect(browser.getQueryState(catalogKey)?.dataUpdatedAt).toBe(1);
    expect(browser.getQueryData(productKey)).toEqual({ name: "Kaos" });
  });

  it("replaces a query that only failed in the browser", () => {
    const browser = createQueryClient();
    browser
      .getQueryCache()
      .build(browser, { queryKey: catalogKey })
      .setState({ status: "error", error: new Error("down") });

    mount(
      browser,
      serverState((server) => {
        server.setQueryData(catalogKey, { pages: [["p1"]], pageParams: [""] });
      }),
    );

    expect(browser.getQueryData(catalogKey)).toEqual({
      pages: [["p1"]],
      pageParams: [""],
    });
  });
});
