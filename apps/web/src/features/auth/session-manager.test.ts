import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@goshop/shared";
import {
  api,
  deferred,
  errorResponse,
  fetchMock,
  noContentResponse,
  requestUrl,
  user,
  webSessionResponse,
} from "@/test/fake-api.ts";
import type { Session } from "./session-context.ts";
import { createSessionManager, refreshMarginMs } from "./session-manager.ts";
import type { SessionManagerOptions } from "./session-manager.ts";

const budi: Session = { user: user(), accessToken: "a" };

/** Paths of every request sent so far. */
const paths = () =>
  fetchMock.mock.calls.map(([input]) => requestUrl(input).pathname);

/**
 * A manager on the fake API, with a lock that records whether a request
 * was sent while it was held, and a clock the test moves.
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
  fetchMock.mockImplementation(() => {
    held.sentInLock.push(held.inLock);
    const next = answers.shift();
    return next === undefined
      ? Promise.reject(new TypeError("no answer queued"))
      : Promise.resolve(next());
  });
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

const session = (accessToken: string, name = "Budi"): Session => ({
  user: user({ name }),
  accessToken,
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("refreshMarginMs", () => {
  it("is 30 seconds for a normal token, half the lifetime for a short one", () => {
    expect(refreshMarginMs(900_000)).toBe(30_000);
    expect(refreshMarginMs(60_000)).toBe(30_000);
    expect(refreshMarginMs(40_000)).toBe(20_000);
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
    ["a network error", () => Promise.reject(new TypeError("offline"))],
  ])(
    "leaves a guest after %s, without onStart or onEnd",
    async (_name, reply) => {
      const onStart = vi.fn(() => Promise.resolve());
      const { manager, answer, onChange, onEnd } = setup({ onStart });
      answer(reply);

      await expect(manager.restore()).resolves.toBeUndefined();

      expect(onChange).toHaveBeenCalledWith(null);
      expect(manager.getSession()).toBeNull();
      expect(onStart).not.toHaveBeenCalled();
      expect(onEnd).not.toHaveBeenCalled();
    },
  );

  it("asks nothing when the session was given at the start", async () => {
    const { manager, onChange } = setup({ initialSession: budi });

    await manager.restore();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(manager.getSession()).toBe(budi);
  });

  it("runs onStart with a client that sends the new token, before publishing", async () => {
    const seen: {
      published: number;
      status?: string;
      bearer: string | null;
    }[] = [];
    let onChangeCalls = 0;
    const onStart = vi.fn(async (client: ApiClient, started: Session) => {
      await client.request("/v1/cart/merge", { method: "POST" });
      const [, init] = fetchMock.mock.calls.at(-1) ?? [];
      seen.push({
        published: onChangeCalls,
        bearer: new Headers(init?.headers).get("Authorization"),
      });
      expect(started).toEqual(session("restored"));
    });
    const { manager, answer, onChange } = setup({ onStart });
    onChange.mockImplementation(() => {
      onChangeCalls += 1;
    });
    answer(
      () => webSessionResponse(user(), "restored"),
      () => Response.json({ data: {} }),
    );

    await manager.restore();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ published: 0, bearer: "Bearer restored" }]);
    // Before publishing, other code still sees no session.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not give other code the token while onStart runs", async () => {
    let tokenDuringStart: string | null = "unread";
    const { manager, answer } = setup({
      onStart: () => {
        tokenDuringStart = manager.getAccessToken();
        return Promise.resolve();
      },
    });
    answer(() => webSessionResponse(user(), "restored"));

    await manager.restore();

    expect(tokenDuringStart).toBeNull();
    expect(manager.getAccessToken()).toBe("restored");
  });
});

describe("login", () => {
  const credentials = { email: "budi@example.com", password: "rahasia" };

  it("logs in inside the lock, starts, then publishes and returns the session", async () => {
    const order: string[] = [];
    const { manager, answer, held, onChange } = setup({
      onStart: () => {
        order.push("onStart");
        return Promise.resolve();
      },
    });
    onChange.mockImplementation(() => order.push("onChange"));
    answer(() => webSessionResponse(user({ name: "Siti" }), "fresh"));

    await expect(manager.login(credentials)).resolves.toEqual(
      session("fresh", "Siti"),
    );

    expect(paths()).toEqual(["/v1/auth/web/login"]);
    expect(held.sentInLock).toEqual([true]);
    expect(order).toEqual(["onStart", "onChange"]);
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
    ["the network", () => Promise.reject(new TypeError("offline"))],
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
    ["a network error", () => Promise.reject(new TypeError("offline"))],
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
    fetchMock.mockClear();
    return setupResult;
  };

  it("is null for a guest", async () => {
    const { manager } = setup({ initialSession: null });

    await expect(manager.ensureFreshToken()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the token without a request until 30 s before it expires", async () => {
    const { manager, clock } = await loggedIn(900);

    clock.now = 869_999;
    await expect(manager.ensureFreshToken()).resolves.toBe("first");

    expect(fetchMock).not.toHaveBeenCalled();
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
    fetchMock.mockClear();

    clock.now = 870_000 + 869_999;
    await expect(manager.ensureFreshToken()).resolves.toBe("second");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the current token when the refresh fails without ending the session", async () => {
    const { manager, clock, answer } = await loggedIn(900);
    answer(() => errorResponse(500, "INTERNAL_ERROR"));
    clock.now = 870_000;

    await expect(manager.ensureFreshToken()).resolves.toBe("first");
    expect(manager.getAccessToken()).toBe("first");
  });

  it("is null when the refresh ends the session", async () => {
    const { manager, clock, answer, onEnd } = await loggedIn(900);
    answer(() => errorResponse(401, "TOKEN_EXPIRED"));
    clock.now = 870_000;

    await expect(manager.ensureFreshToken()).resolves.toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("never refreshes ahead a session whose expiry is unknown", async () => {
    const given = setup({ initialSession: budi });
    given.clock.now = 10 ** 12;
    await expect(given.manager.ensureFreshToken()).resolves.toBe("a");

    const set = setup({ initialSession: null });
    set.manager.setSession(session("set"));
    set.clock.now = 10 ** 12;
    await expect(set.manager.ensureFreshToken()).resolves.toBe("set");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("refreshAfterUnauthorized", () => {
  it("returns the newer token without a refresh when another request already replaced it", async () => {
    const { manager } = setup({ initialSession: session("newer") });

    await expect(manager.refreshAfterUnauthorized("older")).resolves.toBe(
      "newer",
    );
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("setSession", () => {
  it("publishes the session without a request", () => {
    const { manager, onChange } = setup({ initialSession: null });

    manager.setSession(budi);

    expect(onChange).toHaveBeenCalledWith(budi);
    expect(manager.getAccessToken()).toBe("a");
    expect(fetchMock).not.toHaveBeenCalled();
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
