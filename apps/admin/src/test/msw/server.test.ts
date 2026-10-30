// The safety net of every test: a request no handler answers fails the
// test that sent it, even when the code under test swallows the error.
import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { API_URL } from "./http.ts";
import { server, takeUnhandledRequests } from "./server.ts";

const url = `${API_URL}/v1/admin/unhandled-probe`;

/**
 * The few parts of node:http this file uses. Node's own types stay out of
 * the dashboard's type check (they would let app code use `process` or
 * `Buffer` and still type-check), so the module is loaded by a name the
 * type checker does not follow, and typed here.
 */
interface NodeHttp {
  createServer: (
    handle: (
      request: unknown,
      response: { end: (body: string) => void },
    ) => void,
  ) => {
    listen: (port: number, host: string, ready: () => void) => void;
    address: () => { port: number };
    close: () => void;
  };
}
const NODE_HTTP = "node:http";
const nodeHttp = async () =>
  (await import(/* @vite-ignore */ NODE_HTTP)) as NodeHttp;

describe("the MSW server", () => {
  afterEach(() => {
    // Nothing a test here leaves behind may reach the setup's check.
    takeUnhandledRequests();
  });

  it("refuses an unanswered request and records it for the setup's check", async () => {
    await expect(fetch(url)).rejects.toThrow();
    expect(takeUnhandledRequests()).toEqual([`GET ${url}`]);
    // Taken: the list is empty again.
    expect(takeUnhandledRequests()).toEqual([]);
  });

  it("records an unanswered request even when the caller swallows the failure", async () => {
    await fetch(url, { method: "POST" }).catch(() => undefined);
    expect(takeUnhandledRequests()).toEqual([`POST ${url}`]);
  });

  it("never lets an unanswered request through to a real server", async () => {
    let reached = 0;
    const { createServer } = await nodeHttp();
    const real = createServer((_request, response) => {
      reached += 1;
      response.end("real");
    });
    await new Promise<void>((resolve) => {
      real.listen(0, "127.0.0.1", resolve);
    });
    const { port } = real.address();
    const realUrl = `http://127.0.0.1:${String(port)}/v1/admin/orders`;

    try {
      await expect(fetch(realUrl)).rejects.toThrow();
    } finally {
      real.close();
    }

    expect(reached).toBe(0);
    expect(takeUnhandledRequests()).toEqual([`GET ${realUrl}`]);
  });

  it("records nothing for a request a handler answers", async () => {
    server.use(http.get(url, () => HttpResponse.json({ ok: true })));
    const response = await fetch(url);
    expect(await response.json()).toEqual({ ok: true });
    expect(takeUnhandledRequests()).toEqual([]);
  });
});
