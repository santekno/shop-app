// The safety net of every test: a request no handler answers fails the
// test that sent it, even when the code under test swallows the error.
import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { API_URL } from "./http.ts";
import { server, takeUnhandledRequests } from "./server.ts";

const url = `${API_URL}/v1/admin/unhandled-probe`;

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

  it("records nothing for a request a handler answers", async () => {
    server.use(http.get(url, () => HttpResponse.json({ ok: true })));
    const response = await fetch(url);
    expect(await response.json()).toEqual({ ok: true });
    expect(takeUnhandledRequests()).toEqual([]);
  });
});
