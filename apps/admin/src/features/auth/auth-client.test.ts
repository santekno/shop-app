import { ApiError, isApiError } from "@goshop/shared";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api.ts";
import { deferred } from "@/test/msw/answers.ts";
import { API_URL, errorResponse } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import {
  createAuthClient,
  withAccessToken,
  withBearer,
} from "./auth-client.ts";
import type { TokenSource } from "./auth-client.ts";

/** The Authorization header of every request to /v1/admin/x, in order. */
let bearers: (string | null)[] = [];

/** Answers the requests to /v1/admin/x with `answers`, in order. */
const serve = (...answers: (() => Response)[]) => {
  server.use(
    http.all(`${API_URL}/v1/admin/x`, ({ request }) => {
      bearers.push(request.headers.get("Authorization"));
      const next = answers.shift();
      if (next === undefined) throw new Error("no answer queued");
      return next();
    }),
  );
};

const ok = () => HttpResponse.json({ data: "ok" });

/** A token source whose answers the test decides. */
interface TokenAnswers {
  fresh?: string | null;
  afterUnauthorized?: () => Promise<string | null>;
  afterForbidden?: () => Promise<void>;
}

const tokens = ({
  fresh = "t1",
  afterUnauthorized = () => Promise.resolve("t2"),
  afterForbidden = () => Promise.resolve(),
}: TokenAnswers = {}) =>
  ({
    ensureFreshToken: vi.fn(() => Promise.resolve(fresh)),
    refreshAfterUnauthorized: vi.fn<(stale: string) => Promise<string | null>>(
      () => afterUnauthorized(),
    ),
    refreshAfterForbidden: vi.fn<(stale: string) => Promise<void>>(() =>
      afterForbidden(),
    ),
  }) satisfies TokenSource;

beforeEach(() => {
  bearers = [];
});

describe("withBearer", () => {
  it("adds Authorization and keeps the other headers and options", () => {
    const options = {
      method: "POST" as const,
      headers: { "Idempotency-Key": "k" },
      body: { a: 1 },
    };

    const result = withBearer(options, "abc");

    const headers = new Headers(result.headers);
    expect(headers.get("Authorization")).toBe("Bearer abc");
    expect(headers.get("Idempotency-Key")).toBe("k");
    expect(result.method).toBe("POST");
    expect(result.body).toEqual({ a: 1 });
    expect(options.headers).toEqual({ "Idempotency-Key": "k" });
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
  it("sends without Authorization when there is no token", async () => {
    serve(ok);

    await withAccessToken(api, () => null).request("/v1/admin/x");

    expect(bearers).toEqual([null]);
  });

  it("reads the token at each request, not once", async () => {
    serve(ok, ok);
    let token = "one";
    const client = withAccessToken(api, () => token);

    await client.request("/v1/admin/x");
    token = "two";
    await client.request("/v1/admin/x");

    expect(bearers).toEqual(["Bearer one", "Bearer two"]);
  });
});

describe("createAuthClient", () => {
  it("adds the fresh token and returns the answer", async () => {
    serve(ok);
    const client = createAuthClient(api, tokens());

    await expect(client.request("/v1/admin/x")).resolves.toEqual({
      data: "ok",
    });
    expect(bearers).toEqual(["Bearer t1"]);
  });

  it("sends the request as it is when there never was a session", async () => {
    serve(() => errorResponse(401, "UNAUTHORIZED"));
    const source = tokens({ fresh: null });

    await expect(
      createAuthClient(api, source).request("/v1/admin/x"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(bearers).toEqual([null]);
    expect(source.refreshAfterUnauthorized).not.toHaveBeenCalled();
  });

  it("sends nothing when the proactive refresh ended the session", async () => {
    serve(ok);
    const source = tokens();
    source.ensureFreshToken.mockRejectedValueOnce(
      new ApiError({ status: 401, code: "UNAUTHORIZED", message: "ended" }),
    );

    await expect(
      createAuthClient(api, source).request("/v1/admin/x"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(bearers).toEqual([]);
  });

  it("refreshes once after a 401 and sends the same request again", async () => {
    serve(() => errorResponse(401, "UNAUTHORIZED"), ok);
    const source = tokens({ fresh: "stale" });

    await expect(
      createAuthClient(api, source).request("/v1/admin/x", {
        method: "POST",
        body: { a: 1 },
      }),
    ).resolves.toEqual({ data: "ok" });

    expect(source.refreshAfterUnauthorized).toHaveBeenCalledExactlyOnceWith(
      "stale",
    );
    expect(bearers).toEqual(["Bearer stale", "Bearer t2"]);
  });

  it("throws a second 401 instead of looping", async () => {
    serve(
      () => errorResponse(401, "UNAUTHORIZED"),
      () => errorResponse(401, "UNAUTHORIZED"),
    );
    const source = tokens();

    await expect(
      createAuthClient(api, source).request("/v1/admin/x"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(bearers).toHaveLength(2);
    expect(source.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("rethrows the original 401 when the refresh ends the session", async () => {
    serve(() => errorResponse(401, "UNAUTHORIZED", { requestId: "first" }));
    const source = tokens({ afterUnauthorized: () => Promise.resolve(null) });

    const error = await createAuthClient(api, source)
      .request("/v1/admin/x")
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "UNAUTHORIZED", requestId: "first" });
    expect(bearers).toHaveLength(1);
  });

  it("fails with the refresh's own error when it fails otherwise", async () => {
    serve(() => errorResponse(401, "UNAUTHORIZED"));
    const source = tokens({
      afterUnauthorized: () =>
        Promise.reject(
          new ApiError({ status: 503, code: "UNAVAILABLE", message: "down" }),
        ),
    });

    await expect(
      createAuthClient(api, source).request("/v1/admin/x"),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("throws other errors at once, refreshing nothing", async () => {
    serve(() => errorResponse(409, "INVALID_TRANSITION"));
    const source = tokens();

    await expect(
      createAuthClient(api, source).request("/v1/admin/x", { method: "POST" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(source.refreshAfterUnauthorized).not.toHaveBeenCalled();
    expect(source.refreshAfterForbidden).not.toHaveBeenCalled();
  });

  describe("a 403 (artikel 08)", () => {
    it("refreshes the session with the refused token, then throws the 403, without a retry", async () => {
      serve(() => errorResponse(403, "FORBIDDEN"));
      const source = tokens({ fresh: "seller-token" });

      const error = await createAuthClient(api, source)
        .request("/v1/admin/x", { method: "POST" })
        .catch((e: unknown) => e);

      expect(isApiError(error, "FORBIDDEN")).toBe(true);
      expect(source.refreshAfterForbidden).toHaveBeenCalledExactlyOnceWith(
        "seller-token",
      );
      expect(source.refreshAfterUnauthorized).not.toHaveBeenCalled();
      expect(bearers).toEqual(["Bearer seller-token"]);
    });

    it("throws only once the refresh has settled", async () => {
      serve(() => errorResponse(403, "FORBIDDEN"));
      const refresh = deferred<undefined>();
      const source = tokens({ afterForbidden: () => refresh.promise });
      let settled = false;

      const pending = createAuthClient(api, source)
        .request("/v1/admin/x")
        .catch((e: unknown) => {
          settled = true;
          return e;
        });
      await vi.waitFor(() => {
        expect(source.refreshAfterForbidden).toHaveBeenCalled();
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      refresh.resolve(undefined);
      expect(isApiError(await pending, "FORBIDDEN")).toBe(true);
    });

    it("does not refresh for a 403 to the retry after a 401: that token is new", async () => {
      serve(
        () => errorResponse(401, "UNAUTHORIZED"),
        () => errorResponse(403, "FORBIDDEN"),
      );
      const source = tokens();

      await expect(
        createAuthClient(api, source).request("/v1/admin/x"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(source.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
      expect(source.refreshAfterForbidden).not.toHaveBeenCalled();
    });
  });
});
