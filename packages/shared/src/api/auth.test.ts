import { describe, expect, it, vi } from "vitest";
import { login, register } from "./auth.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { TokenPair, User } from "./types.ts";

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
