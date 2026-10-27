import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import { getMe } from "./me.ts";
import type { User } from "./types.ts";

const user: User = {
  id: "u1",
  email: "budi@example.com",
  name: "Budi",
  phone: "+6281234567890",
  role: "buyer",
  email_verified: true,
  created_at: "2026-10-01T00:00:00Z",
};

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
  return { api, fetchMock };
};

describe("getMe", () => {
  it("GETs /v1/me and returns the account, sending no cookie", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: user }));

    await expect(getMe(api)).resolves.toEqual(user);

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("http://api.test/v1/me");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBeUndefined();
  });

  it("throws UNAUTHORIZED without a valid token", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "UNAUTHORIZED", message: "no" } },
        { status: 401 },
      ),
    );

    const error: unknown = await getMe(api).catch((e: unknown) => e);
    expect(isApiError(error, "UNAUTHORIZED")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: user }));
    const controller = new AbortController();
    const fetchSignal = () => fetchMock.mock.calls[0]?.[1]?.signal;

    const pending = getMe(api, { signal: controller.signal });
    expect(fetchSignal()?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal()?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
