import { ApiError } from "@goshop/shared";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api.ts";
import { user, webSession } from "@/test/fixtures.ts";
import { deferred, noContent, networkError } from "@/test/msw/answers.ts";
import { sessionResponse } from "@/test/msw/auth.ts";
import { API_URL, errorResponse } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import type { Session } from "./session-context.ts";
import { createSessionManager, refreshMarginMs } from "./session-manager.ts";
import type { SessionManagerOptions } from "./session-manager.ts";

// The storefront's session-manager tests (apps/web), on MSW instead of a
// fake fetch, plus what only the dashboard has: every cookie call names
// the dashboard (`X-GoShop-Client: admin`), and refreshAfterForbidden.

const budi: Session = { user: user(), accessToken: "a" };

/** What the three cookie endpoints received, in order. */
interface Sent {
  path: string;
  client: string | null;
  inLock: boolean;
}

let sent: Sent[] = [];

/** Paths of every request sent so far. */
const paths = () => sent.map((request) => request.path);

const webSessionResponse = (
  account: ReturnType<typeof user>,
  token: string,
  expiresIn = 900,
) => sessionResponse(webSession(token, account, expiresIn));

const noContentResponse = () => noContent();

/**
 * A manager on the real API client, with MSW answering the three cookie
 * endpoints from a queue; a lock that records whether a request was sent
 * while it was held, and a clock the test moves.
 */
const setup = (options: Partial<SessionManagerOptions> = {}) => {
  const clock = { now: 0 };
  const held = { inLock: false, lockCalls: 0, sentInLock: [] as boolean[] };
  const lock = async <T>(task: () => Promise<T>): Promise<T> => {
    held.lockCalls += 1;
    held.inLock = true;
    try {
      return await task();
    } finally {
      held.inLock = false;
    }
  };
  const onChange = vi.fn<(session: Session | null) => void>();
  const onEnd = vi.fn<() => void>();
  const answers: (() => Response | Promise<Response>)[] = [];
  server.use(
    http.post(`${API_URL}/v1/auth/web/:action`, ({ request }) => {
      held.sentInLock.push(held.inLock);
      sent.push({
        path: new URL(request.url).pathname,
        client: request.headers.get("X-GoShop-Client"),
        inLock: held.inLock,
      });
      const next = answers.shift();
      if (next === undefined) throw new Error("no answer queued");
      return next();
    }),
  );
  const manager = createSessionManager({
    api,
    onChange,
    onEnd,
    lock,
    now: () => clock.now,
    ...options,
  });
  /** Queues the answers of the next requests, in order. */
  const answer = (...next: (() => Response | Promise<Response>)[]) => {
    answers.push(...next);
  };
  return { manager, clock, held, onChange, onEnd, answer };
};

const session = (accessToken: string, name = "Sari"): Session => ({
  user: user({ name }),
  accessToken,
});

beforeEach(() => {
  sent = [];
});

describe("refreshMarginMs", () => {
  it("is 30 seconds for a normal token, half the lifetime for a short one", () => {
    expect(refreshMarginMs(900_000)).toBe(30_000);
    expect(refreshMarginMs(60_000)).toBe(30_000);
    expect(refreshMarginMs(40_000)).toBe(20_000);
  });
});

describe("the dashboard's cookie", () => {
  it("names the dashboard on restore, login, refresh and logout", async () => {
    const { manager, answer } = setup();
    answer(
      () => webSessionResponse(user(), "restored"),
      () => webSessionResponse(user(), "logged-in"),
      () => webSessionResponse(user(), "refreshed"),
      () => noContentResponse(),
    );

    await manager.restore();
    await manager.login({ email: "sari@goshop.test", password: "x" });
    await manager.refresh();
    await manager.logout();

    expect(sent.map(({ path, client }) => [path, client])).toEqual([
      ["/v1/auth/web/refresh", "admin"],
      ["/v1/auth/web/login", "admin"],
      ["/v1/auth/web/refresh", "admin"],
      ["/v1/auth/web/logout", "admin"],
    ]);
  });
});

describe("restore", () => {
  it("asks for a session with the cookie once, however often it is called", async () => {
    const { manager, answer, onChange } = setup();
    answer(() => webSessionResponse(user(), "restored"));

    const first = manager.restore();
    const second = manager.restore();
    await first;

    expect(second).toBe(first);
    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(session("restored"));
    expect(manager.getAccessToken()).toBe("restored");
  });

  it("sends the refresh inside the session lock", async () => {
    const { manager, answer, held } = setup();
    answer(() => noContentResponse());

    await manager.restore();

    expect(held.sentInLock).toEqual([true]);
  });

  it.each([
    ["204 (no cookie)", () => noContentResponse()],
    ["401 (a refused cookie)", () => errorResponse(401, "TOKEN_INVALID")],
    ["500", () => errorResponse(500, "INTERNAL_ERROR")],
    ["a network error", () => networkError()],
  ])("leaves a guest after %s, without onEnd", async (_name, reply) => {
    const { manager, answer, onChange, onEnd } = setup();
    answer(reply);

    await expect(manager.restore()).resolves.toBeUndefined();

    expect(onChange).toHaveBeenCalledWith(null);
    expect(manager.getSession()).toBeNull();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("asks nothing when the session was given at the start", async () => {
    const { manager, onChange } = setup({ initialSession: budi });

    await manager.restore();

    expect(sent).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    expect(manager.getSession()).toBe(budi);
  });
});

describe("login", () => {
  const credentials = { email: "sari@goshop.test", password: "rahasia" };

  it("logs in inside the lock, then publishes and returns the session", async () => {
    const { manager, answer, held, onChange } = setup();
    answer(() => webSessionResponse(user({ name: "Siti" }), "fresh"));

    await expect(manager.login(credentials)).resolves.toEqual(
      session("fresh", "Siti"),
    );

    expect(paths()).toEqual(["/v1/auth/web/login"]);
    expect(held.sentInLock).toEqual([true]);
    expect(onChange).toHaveBeenCalledWith(session("fresh", "Siti"));
    expect(manager.getAccessToken()).toBe("fresh");
  });

  it("rejects with the API's error and changes nothing", async () => {
    const { manager, answer, onChange } = setup({ initialSession: null });
    answer(() => errorResponse(401, "INVALID_CREDENTIALS"));

    await expect(manager.login(credentials)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(manager.getSession()).toBeNull();
  });
});

describe("logout", () => {
  it("ends the session on the server inside the lock, then here, then runs onEnd", async () => {
    const { manager, answer, held, onChange, onEnd } = setup({
      initialSession: budi,
    });
    answer(() => noContentResponse());

    await manager.logout();

    expect(paths()).toEqual(["/v1/auth/web/logout"]);
    expect(held.sentInLock).toEqual([true]);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(manager.getSession()).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a server error", () => errorResponse(500, "INTERNAL_ERROR")],
    ["the network", () => networkError()],
  ])("keeps the session when %s stops it", async (_name, reply) => {
    const { manager, answer, onChange, onEnd } = setup({
      initialSession: budi,
    });
    answer(reply);

    await expect(manager.logout()).rejects.toBeTruthy();

    expect(manager.getSession()).toBe(budi);
    expect(onChange).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("does not run onEnd when nobody was logged in", async () => {
    const { manager, answer, onEnd } = setup({ initialSession: null });
    answer(() => noContentResponse());

    await manager.logout();

    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe("refresh", () => {
  it("sends one refresh for callers that ask at the same time", async () => {
    const { manager, answer, held } = setup({ initialSession: budi });
    const reply = deferred<Response>();
    answer(() => reply.promise);

    const first = manager.refresh();
    const second = manager.refresh();
    reply.resolve(webSessionResponse(user(), "new"));

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(session("new"));
    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
    expect(held.lockCalls).toBe(1);
  });

  it("sends a new refresh once the last one has settled", async () => {
    const { manager, answer } = setup({ initialSession: budi });
    answer(
      () => webSessionResponse(user(), "one"),
      () => webSessionResponse(user(), "two"),
    );

    await manager.refresh();
    await expect(manager.refresh()).resolves.toEqual(session("two"));

    expect(paths()).toHaveLength(2);
  });

  it("publishes the new token", async () => {
    const { manager, answer, onChange, held } = setup({ initialSession: budi });
    answer(() => webSessionResponse(user(), "new"));

    await manager.refresh();

    expect(onChange).toHaveBeenLastCalledWith(session("new"));
    expect(manager.getAccessToken()).toBe("new");
    expect(held.sentInLock).toEqual([true]);
  });

  it.each([
    ["204", () => noContentResponse()],
    ["401 TOKEN_INVALID", () => errorResponse(401, "TOKEN_INVALID")],
    ["401 TOKEN_EXPIRED", () => errorResponse(401, "TOKEN_EXPIRED")],
    ["401 UNAUTHORIZED", () => errorResponse(401, "UNAUTHORIZED")],
  ])("ends the session on %s and resolves to null", async (_name, reply) => {
    const { manager, answer, onChange, onEnd } = setup({
      initialSession: budi,
    });
    answer(reply);

    await expect(manager.refresh()).resolves.toBeNull();

    expect(manager.getSession()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["500", () => errorResponse(500, "INTERNAL_ERROR")],
    ["429", () => errorResponse(429, "RATE_LIMITED")],
    ["a network error", () => networkError()],
  ])("rejects on %s and keeps the session", async (_name, reply) => {
    const { manager, answer, onChange, onEnd } = setup({
      initialSession: budi,
    });
    answer(reply);

    await expect(manager.refresh()).rejects.toBeTruthy();

    expect(manager.getSession()).toBe(budi);
    expect(onChange).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe("ensureFreshToken", () => {
  /** Logs in at clock 0 with a token that lives `expiresIn` seconds. */
  const loggedIn = async (expiresIn = 900) => {
    const setupResult = setup();
    setupResult.answer(() => webSessionResponse(user(), "first", expiresIn));
    await setupResult.manager.login({ email: "b@example.com", password: "x" });
    sent = [];
    return setupResult;
  };

  it("is null for a guest", async () => {
    const { manager } = setup({ initialSession: null });

    await expect(manager.ensureFreshToken()).resolves.toBeNull();
    expect(sent).toEqual([]);
  });

  it("returns the token without a request until 30 s before it expires", async () => {
    const { manager, clock } = await loggedIn(900);

    clock.now = 869_999;
    await expect(manager.ensureFreshToken()).resolves.toBe("first");

    expect(sent).toEqual([]);
  });

  it("refreshes first once the margin is reached", async () => {
    const { manager, clock, answer } = await loggedIn(900);
    answer(() => webSessionResponse(user(), "second"));

    clock.now = 870_000;
    await expect(manager.ensureFreshToken()).resolves.toBe("second");

    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
  });

  it("uses half the lifetime as the margin for a short token", async () => {
    const { manager, clock, answer } = await loggedIn(40);
    answer(() => webSessionResponse(user(), "second", 40));

    clock.now = 19_999;
    await expect(manager.ensureFreshToken()).resolves.toBe("first");
    clock.now = 20_000;
    await expect(manager.ensureFreshToken()).resolves.toBe("second");

    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
  });

  it("shares one refresh between requests that need it together", async () => {
    const { manager, clock, answer } = await loggedIn(900);
    answer(() => webSessionResponse(user(), "second"));
    clock.now = 900_000;

    const tokens = await Promise.all([
      manager.ensureFreshToken(),
      manager.ensureFreshToken(),
      manager.ensureFreshToken(),
    ]);

    expect(tokens).toEqual(["second", "second", "second"]);
    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
  });

  it("measures the next expiry from the refreshed token", async () => {
    const { manager, clock, answer } = await loggedIn(900);
    answer(() => webSessionResponse(user(), "second", 900));
    clock.now = 870_000;
    await manager.ensureFreshToken();
    sent = [];

    clock.now = 870_000 + 869_999;
    await expect(manager.ensureFreshToken()).resolves.toBe("second");
    expect(sent).toEqual([]);
  });

  it("keeps the current token when the refresh fails without ending the session", async () => {
    const { manager, clock, answer } = await loggedIn(900);
    answer(() => errorResponse(500, "INTERNAL_ERROR"));
    clock.now = 870_000;

    await expect(manager.ensureFreshToken()).resolves.toBe("first");
    expect(manager.getAccessToken()).toBe("first");
  });

  // null would mean "a guest from the start" to the interceptor, which
  // would then send the request without a token, as a guest's.
  it.each([
    ["no cookie any more (204, logged out in another tab)", noContentResponse],
    [
      "a refused cookie (401, revoked)",
      () => errorResponse(401, "TOKEN_EXPIRED"),
    ],
  ])(
    "rejects with 401 UNAUTHORIZED, ending the session, when the refresh finds %s",
    async (_name, refreshAnswer) => {
      const { manager, clock, answer, onEnd, onChange } = await loggedIn(900);
      answer(refreshAnswer);
      clock.now = 870_000;

      const error = await manager.ensureFreshToken().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(null);
      expect(manager.getSession()).toBeNull();
      expect(paths()).toEqual(["/v1/auth/web/refresh"]);
    },
  );

  it("rejects every request that waited for the same ending refresh", async () => {
    const { manager, clock, answer, onEnd } = await loggedIn(900);
    answer(noContentResponse);
    clock.now = 870_000;

    const results = await Promise.allSettled([
      manager.ensureFreshToken(),
      manager.ensureFreshToken(),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
  });

  it("is null, asking nothing, once the ended session is gone", async () => {
    const { manager, clock, answer } = await loggedIn(900);
    answer(noContentResponse);
    clock.now = 870_000;
    await manager.ensureFreshToken().catch(() => undefined);
    sent = [];

    await expect(manager.ensureFreshToken()).resolves.toBeNull();
    expect(sent).toEqual([]);
  });

  it("never refreshes ahead a session whose expiry is unknown", async () => {
    const given = setup({ initialSession: budi });
    given.clock.now = 10 ** 12;
    await expect(given.manager.ensureFreshToken()).resolves.toBe("a");

    const set = setup({ initialSession: null });
    set.manager.setSession(session("set"));
    set.clock.now = 10 ** 12;
    await expect(set.manager.ensureFreshToken()).resolves.toBe("set");

    expect(sent).toEqual([]);
  });
});

describe("refreshAfterUnauthorized", () => {
  it("returns the newer token without a refresh when another request already replaced it", async () => {
    const { manager } = setup({ initialSession: session("newer") });

    await expect(manager.refreshAfterUnauthorized("older")).resolves.toBe(
      "newer",
    );
    expect(sent).toEqual([]);
  });

  it("refreshes when the refused token is still the current one", async () => {
    const { manager, answer } = setup({ initialSession: session("stale") });
    answer(() => webSessionResponse(user(), "fresh"));

    await expect(manager.refreshAfterUnauthorized("stale")).resolves.toBe(
      "fresh",
    );
    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
  });

  it("shares one refresh between 401s that arrive together", async () => {
    const { manager, answer } = setup({ initialSession: session("stale") });
    answer(() => webSessionResponse(user(), "fresh"));

    const tokens = await Promise.all([
      manager.refreshAfterUnauthorized("stale"),
      manager.refreshAfterUnauthorized("stale"),
    ]);

    expect(tokens).toEqual(["fresh", "fresh"]);
    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
  });

  it("is null when the refresh ends the session", async () => {
    const { manager, answer, onEnd } = setup({ initialSession: budi });
    answer(() => noContentResponse());

    await expect(manager.refreshAfterUnauthorized("a")).resolves.toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("rejects, keeping the session, when the refresh fails otherwise", async () => {
    const { manager, answer } = setup({ initialSession: budi });
    answer(() => errorResponse(500, "INTERNAL_ERROR"));

    await expect(manager.refreshAfterUnauthorized("a")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(manager.getSession()).toBe(budi);
  });
});

describe("refreshAfterForbidden", () => {
  it("refreshes once when the refused token is the current one, bringing the new role", async () => {
    const { manager, answer, onChange } = setup({
      initialSession: session("stale"),
    });
    answer(() => webSessionResponse(user({ role: "buyer" }), "fresh"));

    await expect(
      manager.refreshAfterForbidden("stale"),
    ).resolves.toBeUndefined();

    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
    expect(manager.getAccessToken()).toBe("fresh");
    expect(manager.getSession()?.user.role).toBe("buyer");
    expect(onChange).toHaveBeenLastCalledWith({
      user: user({ role: "buyer" }),
      accessToken: "fresh",
    });
  });

  it("does nothing without a session", async () => {
    const { manager } = setup({ initialSession: null });

    await manager.refreshAfterForbidden("stale");

    expect(sent).toEqual([]);
  });

  it("does nothing when another request has replaced the token already", async () => {
    const { manager } = setup({ initialSession: session("newer") });

    await manager.refreshAfterForbidden("older");

    expect(sent).toEqual([]);
    expect(manager.getAccessToken()).toBe("newer");
  });

  it("never refreshes again for a token its own refresh issued", async () => {
    const { manager, answer } = setup({ initialSession: session("stale") });
    answer(() => webSessionResponse(user(), "fresh"));

    await manager.refreshAfterForbidden("stale");
    // The page asks again with the new token and gets 403 again: the role
    // really may not do it, and one refresh has said so already.
    await manager.refreshAfterForbidden("fresh");
    await manager.refreshAfterForbidden("fresh");

    expect(paths()).toEqual(["/v1/auth/web/refresh"]);
  });

  it("refreshes again after a 401 refresh replaced its token", async () => {
    const { manager, answer } = setup({ initialSession: session("stale") });
    answer(
      () => webSessionResponse(user(), "after-403"),
      () => webSessionResponse(user(), "after-401"),
      () => webSessionResponse(user(), "after-second-403"),
    );

    await manager.refreshAfterForbidden("stale");
    await manager.refreshAfterUnauthorized("after-403");
    await manager.refreshAfterForbidden("after-401");

    expect(paths()).toHaveLength(3);
    expect(manager.getAccessToken()).toBe("after-second-403");
  });

  it.each([
    ["a server error", () => errorResponse(500, "INTERNAL_ERROR")],
    ["the network", () => networkError()],
  ])(
    "resolves, keeping the session, when %s fails the refresh",
    async (_name, reply) => {
      const { manager, answer, onEnd } = setup({
        initialSession: session("stale"),
      });
      answer(reply);

      await expect(
        manager.refreshAfterForbidden("stale"),
      ).resolves.toBeUndefined();

      expect(manager.getAccessToken()).toBe("stale");
      expect(onEnd).not.toHaveBeenCalled();
    },
  );

  it("ends the session when the refresh finds it over", async () => {
    const { manager, answer, onEnd, onChange } = setup({
      initialSession: session("stale"),
    });
    answer(() => noContentResponse());

    await expect(
      manager.refreshAfterForbidden("stale"),
    ).resolves.toBeUndefined();

    expect(manager.getSession()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("setSession", () => {
  it("publishes the session without a request", () => {
    const { manager, onChange } = setup({ initialSession: null });

    manager.setSession(budi);

    expect(onChange).toHaveBeenCalledWith(budi);
    expect(manager.getAccessToken()).toBe("a");
    expect(sent).toEqual([]);
  });
});

describe("where the tokens are kept", () => {
  it("keeps the access token in memory only: never in web storage or a script-readable cookie", async () => {
    const { manager, answer, clock } = setup();
    answer(
      () => webSessionResponse(user(), "secret-login-token"),
      () => webSessionResponse(user(), "secret-refresh-token"),
    );

    await manager.login({ email: "b@example.com", password: "x" });
    clock.now = 10 ** 9;
    await manager.ensureFreshToken();

    expect(manager.getAccessToken()).toBe("secret-refresh-token");
    const stored = [window.localStorage, window.sessionStorage].flatMap(
      (storage) =>
        Object.keys(storage).map(
          (key) => `${key}=${storage.getItem(key) ?? ""}`,
        ),
    );
    expect(stored.join(";")).not.toContain("secret");
    expect(document.cookie).not.toContain("secret");
  });
});
