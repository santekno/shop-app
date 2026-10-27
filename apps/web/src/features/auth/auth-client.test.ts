import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  deferred,
  errorResponse,
  fetchMock,
  noContentResponse,
  requestUrl,
  serve,
  user,
  webSessionResponse,
} from "@/test/fake-api.ts";
import {
  createAuthClient,
  withAccessToken,
  withBearer,
} from "./auth-client.ts";
import type { TokenSource } from "./auth-client.ts";
import { createSessionManager } from "./session-manager.ts";

/** The Authorization header of every request sent, in order. */
const bearers = () =>
  fetchMock.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get("Authorization"),
  );

/** A token source whose answers the test decides. */
const tokens = (
  fresh: string | null,
  afterUnauthorized: () => Promise<string | null> = () =>
    Promise.resolve("fresh"),
) => {
  const source = {
    ensureFreshToken: vi.fn(() => Promise.resolve(fresh)),
    refreshAfterUnauthorized: vi.fn<(stale: string) => Promise<string | null>>(
      () => afterUnauthorized(),
    ),
  } satisfies TokenSource;
  return source;
};

const ok = () => Response.json({ data: "ok" });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("withBearer", () => {
  it("adds Authorization and keeps the other headers and options", () => {
    const options = {
      method: "POST" as const,
      headers: { "X-Cart-Token": "tok" },
      body: { a: 1 },
    };

    const result = withBearer(options, "abc");

    const headers = new Headers(result.headers);
    expect(headers.get("Authorization")).toBe("Bearer abc");
    expect(headers.get("X-Cart-Token")).toBe("tok");
    expect(result.method).toBe("POST");
    expect(result.body).toEqual({ a: 1 });
    // The caller's options are not changed.
    expect(options.headers).toEqual({ "X-Cart-Token": "tok" });
  });

  it("replaces an Authorization that was already there", () => {
    const result = withBearer(
      { headers: { Authorization: "Bearer old" } },
      "new",
    );

    expect(new Headers(result.headers).get("Authorization")).toBe("Bearer new");
  });
});

describe("withAccessToken", () => {
  it("sends a guest's request without Authorization", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok()));
    const client = withAccessToken(api, () => null);

    await client.request("/v1/cart", { headers: { "X-Cart-Token": "tok" } });

    expect(bearers()).toEqual([null]);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-Cart-Token"),
    ).toBe("tok");
  });

  it("reads the token at each request, not once", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok()));
    let token = "one";
    const client = withAccessToken(api, () => token);

    await client.request("/v1/me");
    token = "two";
    await client.request("/v1/me");

    expect(bearers()).toEqual(["Bearer one", "Bearer two"]);
  });
});

describe("createAuthClient", () => {
  it("sends a guest's request as it is, without a token or a retry", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(401, "UNAUTHORIZED")),
    );
    const source = tokens(null);
    const client = createAuthClient(api, source);

    await expect(client.request("/v1/cart")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(bearers()).toEqual([null]);
    expect(source.refreshAfterUnauthorized).not.toHaveBeenCalled();
  });

  it("adds the fresh token and returns the answer", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok()));
    const client = createAuthClient(api, tokens("t1"));

    await expect(client.request("/v1/me")).resolves.toEqual({ data: "ok" });
    expect(bearers()).toEqual(["Bearer t1"]);
  });

  it("refreshes once after a 401 and sends the same request again", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHORIZED"))
      .mockResolvedValueOnce(ok());
    const source = tokens("stale");
    const client = createAuthClient(api, source);

    await expect(
      client.request("/v1/cart/items", {
        method: "POST",
        body: { variant_id: "v", quantity: 1 },
      }),
    ).resolves.toEqual({ data: "ok" });

    expect(source.refreshAfterUnauthorized).toHaveBeenCalledExactlyOnceWith(
      "stale",
    );
    expect(bearers()).toEqual(["Bearer stale", "Bearer fresh"]);
    const [first, second] = fetchMock.mock.calls;
    expect(second?.[1]?.method).toBe("POST");
    expect(second?.[1]?.body).toBe(first?.[1]?.body);
    expect(requestUrl(second?.[0] ?? "").pathname).toBe("/v1/cart/items");
  });

  it("throws a second 401 instead of looping", async () => {
    // 401 twice, then 200: a client that kept retrying would end with the
    // 200 here instead of hanging the suite.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fetchMock.mock.calls.length <= 2
          ? errorResponse(401, "UNAUTHORIZED")
          : ok(),
      ),
    );
    const source = tokens("stale");
    const client = createAuthClient(api, source);

    await expect(client.request("/v1/me")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(source.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("rethrows the original 401 when the refresh ends the session", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(401, "UNAUTHORIZED", "req-1")),
    );
    const client = createAuthClient(
      api,
      tokens("stale", () => Promise.resolve(null)),
    );

    await expect(client.request("/v1/me")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      requestId: "req-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails with the refresh's own error when it fails otherwise", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(401, "UNAUTHORIZED")),
    );
    const refused = new Error("refresh 500");
    const client = createAuthClient(
      api,
      tokens("stale", () => Promise.reject(refused)),
    );

    await expect(client.request("/v1/me")).rejects.toBe(refused);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["500", 500, "INTERNAL_ERROR"],
    ["403 FORBIDDEN", 403, "FORBIDDEN"],
    ["404", 404, "CART_NOT_FOUND"],
    ["a 401 that is not UNAUTHORIZED", 401, "INVALID_CREDENTIALS"],
  ])("does not refresh or retry after %s", async (_name, status, code) => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(status, code)),
    );
    const source = tokens("t1");
    const client = createAuthClient(api, source);

    await expect(client.request("/v1/me")).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(source.refreshAfterUnauthorized).not.toHaveBeenCalled();
  });
});

describe("createAuthClient with the session manager", () => {
  it("shares one refresh between requests whose 401s arrive together", async () => {
    const refreshAnswer = deferred<Response>();
    serve((url, init) => {
      if (url.pathname === "/v1/auth/web/refresh") return refreshAnswer.promise;
      const sent = new Headers(init?.headers).get("Authorization");
      return sent === "Bearer fresh"
        ? Response.json({ data: url.pathname })
        : errorResponse(401, "UNAUTHORIZED");
    });
    const manager = createSessionManager({
      api,
      onChange: () => undefined,
      initialSession: { user: user(), accessToken: "stale" },
    });
    const client = createAuthClient(api, manager);

    const results = Promise.all([
      client.request("/v1/me"),
      client.request("/v1/cart"),
      client.request("/v1/orders"),
    ]);
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestUrl(input).pathname === "/v1/auth/web/refresh",
        ),
      ).toHaveLength(1);
    });
    refreshAnswer.resolve(webSessionResponse(user(), "fresh"));

    await expect(results).resolves.toEqual([
      { data: "/v1/me" },
      { data: "/v1/cart" },
      { data: "/v1/orders" },
    ]);
    const refreshes = fetchMock.mock.calls.filter(
      ([input]) => requestUrl(input).pathname === "/v1/auth/web/refresh",
    );
    expect(refreshes).toHaveLength(1);
    expect(manager.getAccessToken()).toBe("fresh");
  });

  it("retries with the token another request already refreshed, without a second refresh", async () => {
    let refreshes = 0;
    serve((url, init) => {
      if (url.pathname === "/v1/auth/web/refresh") {
        refreshes += 1;
        return webSessionResponse(user(), "fresh");
      }
      const sent = new Headers(init?.headers).get("Authorization");
      return sent === "Bearer fresh"
        ? Response.json({ data: "ok" })
        : errorResponse(401, "UNAUTHORIZED");
    });
    const manager = createSessionManager({
      api,
      onChange: () => undefined,
      initialSession: { user: user(), accessToken: "stale" },
    });
    const client = createAuthClient(api, manager);

    await client.request("/v1/me");
    // A request sent with the stale token, whose 401 arrives later.
    await expect(manager.refreshAfterUnauthorized("stale")).resolves.toBe(
      "fresh",
    );

    expect(refreshes).toBe(1);
  });

  it("ends the session when the refresh is refused, and the caller gets the 401", async () => {
    serve((url) =>
      url.pathname === "/v1/auth/web/refresh"
        ? errorResponse(401, "TOKEN_INVALID")
        : errorResponse(401, "UNAUTHORIZED"),
    );
    const onEnd = vi.fn();
    const manager = createSessionManager({
      api,
      onChange: () => undefined,
      onEnd,
      initialSession: { user: user(), accessToken: "stale" },
    });
    const client = createAuthClient(api, manager);

    await expect(client.request("/v1/me")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(manager.getSession()).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  describe("when the proactive refresh finds the session over", () => {
    /**
     * A buyer logged in at clock 0 with a 60 s token; the clock is then
     * moved past the moment to replace it, so the next request refreshes
     * first. `refreshAnswer` is what /web/refresh says then.
     */
    const expiredSession = async (refreshAnswer: () => Response) => {
      const clock = { now: 0 };
      let refreshed = false;
      serve((url) => {
        if (url.pathname === "/v1/auth/web/login") {
          return webSessionResponse(user(), "first", 60);
        }
        if (url.pathname === "/v1/auth/web/refresh") {
          refreshed = true;
          return refreshAnswer();
        }
        // The API takes a request without a token as a guest's.
        return Response.json({ data: "guest", cart_token: "orphan" });
      });
      const onEnd = vi.fn();
      const manager = createSessionManager({
        api,
        onChange: () => undefined,
        onEnd,
        lock: (task) => task(),
        now: () => clock.now,
      });
      await manager.login({ email: "b@example.com", password: "x" });
      fetchMock.mockClear();
      clock.now = 45_000;
      return { manager, onEnd, wasRefreshed: () => refreshed };
    };

    const sentPaths = () =>
      fetchMock.mock.calls.map(([input]) => requestUrl(input).pathname);

    it.each([
      ["no cookie any more (204)", noContentResponse],
      ["a refused cookie (401)", () => errorResponse(401, "TOKEN_INVALID")],
    ])(
      "throws 401 UNAUTHORIZED and sends nothing as a guest after %s",
      async (_name, refreshAnswer) => {
        const { manager, onEnd, wasRefreshed } =
          await expiredSession(refreshAnswer);
        const client = createAuthClient(api, manager);

        await expect(
          client.request("/v1/cart/items", { method: "POST", body: {} }),
        ).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });

        expect(wasRefreshed()).toBe(true);
        expect(sentPaths()).toEqual(["/v1/auth/web/refresh"]);
        expect(manager.getSession()).toBeNull();
        expect(onEnd).toHaveBeenCalledTimes(1);
      },
    );

    it("still sends a guest's request when there never was a session", async () => {
      serve(() => Response.json({ data: "guest" }));
      const manager = createSessionManager({
        api,
        onChange: () => undefined,
        initialSession: null,
      });
      const client = createAuthClient(api, manager);

      await expect(client.request("/v1/cart")).resolves.toEqual({
        data: "guest",
      });
      expect(sentPaths()).toEqual(["/v1/cart"]);
      expect(bearers()).toEqual([null]);
    });
  });
});
