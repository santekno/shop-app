import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEB_CLIENT_HEADERS,
  login,
  register,
  webLogin,
  webLogout,
  webRefresh,
} from "./auth.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { TokenPair, User, WebSession } from "./types.ts";

const user: User = {
  id: "u1",
  email: "budi@example.com",
  name: "Budi",
  phone: null,
  role: "buyer",
  email_verified: false,
  created_at: "2026-10-01T00:00:00Z",
};

const tokens: TokenPair = {
  access_token: "access",
  token_type: "Bearer",
  expires_in: 900,
  refresh_token: "refresh",
  refresh_expires_in: 2_592_000,
  user,
};

const webSession: WebSession = {
  access_token: "access",
  token_type: "Bearer",
  expires_in: 900,
  user,
};

const errorBody = (status: number, code: string) =>
  Response.json({ error: { code, message: "boom" } }, { status });

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
  const call = () => fetchMock.mock.calls[0] ?? [];
  return { api, fetchMock, call };
};

describe("register", () => {
  const body = {
    name: "Budi",
    email: "budi@example.com",
    password: "rahasia123",
  };

  it("POSTs the account to /v1/auth/register and returns the user", async () => {
    const { api, call } = setup(() =>
      Response.json({ data: user }, { status: 201 }),
    );

    await expect(register(api, body)).resolves.toEqual(user);

    const [input, init] = call();
    expect(input).toBe("http://api.test/v1/auth/register");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(body));
  });

  it("throws EMAIL_TAKEN as an ApiError", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "EMAIL_TAKEN", message: "email taken" } },
        { status: 409 },
      ),
    );

    const error: unknown = await register(api, body).catch((e: unknown) => e);
    expect(isApiError(error, "EMAIL_TAKEN")).toBe(true);
  });
});

describe("login", () => {
  const body = { email: "budi@example.com", password: "rahasia123" };

  it("POSTs the credentials to /v1/auth/login and returns the tokens", async () => {
    const { api, call } = setup(() => Response.json({ data: tokens }));

    await expect(login(api, body)).resolves.toEqual(tokens);

    const [input, init] = call();
    expect(input).toBe("http://api.test/v1/auth/login");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(body));
  });

  it("throws INVALID_CREDENTIALS as an ApiError", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "INVALID_CREDENTIALS", message: "nope" } },
        { status: 401 },
      ),
    );

    const error: unknown = await login(api, body).catch((e: unknown) => e);
    expect(isApiError(error, "INVALID_CREDENTIALS")).toBe(true);
    expect(error).toMatchObject({ status: 401 });
  });
});

describe("register and login send no cookie", () => {
  it.each([
    [
      "register",
      (api: ReturnType<typeof createApiClient>) =>
        register(api, { name: "B", email: "b@example.com", password: "x" }),
    ],
    [
      "login",
      (api: ReturnType<typeof createApiClient>) =>
        login(api, { email: "b@example.com", password: "x" }),
    ],
  ])(
    "%s keeps fetch's default credentials and no X-GoShop-Client",
    async (_name, call) => {
      const { api, call: sent } = setup(() =>
        Response.json({ data: tokens }, { status: 201 }),
      );

      await call(api);

      const [, init] = sent();
      expect(init?.credentials).toBeUndefined();
      expect(new Headers(init?.headers).has("X-GoShop-Client")).toBe(false);
    },
  );
});

describe("the web session calls", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const expectCookieCall = (
    init: RequestInit | undefined,
    path: string,
    input: unknown,
  ) => {
    expect(input).toBe(`http://api.test${path}`);
    expect(init?.method).toBe("POST");
    // The browser sends and stores the httpOnly refresh cookie.
    expect(init?.credentials).toBe("include");
    // A custom header: a CORS preflight the API answers for its own
    // origins only (the CSRF defence).
    expect(new Headers(init?.headers).get("X-GoShop-Client")).toBe("web");
  };

  it("WEB_CLIENT_HEADERS is X-GoShop-Client: web", () => {
    expect(WEB_CLIENT_HEADERS).toEqual({ "X-GoShop-Client": "web" });
  });

  it("webLogin POSTs the credentials with the cookie and returns the session", async () => {
    const body = { email: "budi@example.com", password: "rahasia123" };
    const { api, call } = setup(() => Response.json({ data: webSession }));

    await expect(webLogin(api, body)).resolves.toEqual(webSession);

    const [input, init] = call();
    expectCookieCall(init, "/v1/auth/web/login", input);
    expect(init?.body).toBe(JSON.stringify(body));
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("webLogin throws INVALID_CREDENTIALS", async () => {
    const { api } = setup(() => errorBody(401, "INVALID_CREDENTIALS"));

    const error: unknown = await webLogin(api, {
      email: "b@example.com",
      password: "x",
    }).catch((e: unknown) => e);
    expect(isApiError(error, "INVALID_CREDENTIALS")).toBe(true);
  });

  it("webRefresh returns the new session, sending no body", async () => {
    const { api, call } = setup(() => Response.json({ data: webSession }));

    await expect(webRefresh(api)).resolves.toEqual(webSession);

    const [input, init] = call();
    expectCookieCall(init, "/v1/auth/web/refresh", input);
    expect(init?.body).toBeUndefined();
  });

  it("webRefresh returns null for 204: no cookie, no session", async () => {
    const { api } = setup(() => new Response(null, { status: 204 }));

    await expect(webRefresh(api)).resolves.toBeNull();
  });

  it.each(["TOKEN_INVALID", "TOKEN_EXPIRED", "UNAUTHORIZED"] as const)(
    "webRefresh throws %s for a refused cookie",
    async (code) => {
      const { api } = setup(() => errorBody(401, code));

      const error: unknown = await webRefresh(api).catch((e: unknown) => e);
      expect(isApiError(error, code)).toBe(true);
    },
  );

  it("webRefresh never retries: a second send of the cookie is a reuse", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(errorBody(503, "UNAVAILABLE")),
    );
    const api = createApiClient({
      baseUrl: "http://api.test",
      fetch: fetchMock,
      retries: 3,
      retryDelayMs: 0,
    });

    await expect(webRefresh(api)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("webRefresh waits 20 s, longer than the API's 15 s, before giving up", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const api = createApiClient({
      baseUrl: "http://api.test",
      fetch: fetchMock,
    });
    let settled = false;
    const result = webRefresh(api).catch((e: unknown) => e);
    void result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(isApiError(await result, "CLIENT_TIMEOUT")).toBe(true);
  });

  it("webLogout POSTs with the cookie and resolves on 204", async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));

    await expect(webLogout(api)).resolves.toBeUndefined();

    const [input, init] = call();
    expectCookieCall(init, "/v1/auth/web/logout", input);
  });

  it("webLogout throws when the API could not revoke the session", async () => {
    const { api } = setup(() => errorBody(500, "INTERNAL_ERROR"));

    const error: unknown = await webLogout(api).catch((e: unknown) => e);
    expect(isApiError(error, "INTERNAL_ERROR")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: webSession }));
    const controller = new AbortController();
    const fetchSignal = () => fetchMock.mock.calls[0]?.[1]?.signal;

    const pending = webRefresh(api, { signal: controller.signal });
    expect(fetchSignal()?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal()?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
