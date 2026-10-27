import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  fetchMock,
  requestUrl,
  user,
  userResponse,
  webSessionResponse,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import { useSession } from "../session-context.ts";
import { useLogin } from "./useLogin.ts";
import { useRegister } from "./useRegister.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const credentials = { email: "budi@example.com", password: "rahasia123" };

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useLogin", () => {
  const setup = () =>
    renderHook(() => ({ login: useLogin(), session: useSession() }), {
      wrapper: hookWrapper(),
    });

  it("logs in through the web endpoint and keeps the account and the access token in the session", async () => {
    fetchMock.mockResolvedValue(webSessionResponse(user({ name: "Budi" })));
    const { result } = setup();
    expect(result.current.session.session).toBeNull();

    act(() => {
      result.current.login.mutate(credentials);
    });
    await waitFor(() => {
      expect(result.current.login.isSuccess).toBe(true);
    });

    expect(result.current.session.session).toEqual({
      user: user({ name: "Budi" }),
      accessToken: "access-token",
    });
    expect(result.current.session.status).toBe("authenticated");
    expect(result.current.session.getAccessToken()).toBe("access-token");
    expect(result.current.session.session).not.toHaveProperty("refreshToken");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input && requestUrl(input).pathname).toBe("/v1/auth/web/login");
    expect(init?.body).toBe(JSON.stringify(credentials));
    // The cookie call: the browser stores the httpOnly refresh cookie.
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("X-GoShop-Client")).toBe("web");
  });

  it("leaves the session empty when the login fails, and never retries", async () => {
    fetchMock.mockResolvedValue(errorResponse(401, "INVALID_CREDENTIALS"));
    const { result } = setup();

    act(() => {
      result.current.login.mutate(credentials);
    });
    await waitFor(() => {
      expect(result.current.login.isError).toBe(true);
    });

    expect(result.current.session.session).toBeNull();
    expect(result.current.session.status).toBe("anonymous");
    expect(result.current.login.error).toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useRegister", () => {
  it("creates the account without logging it in", async () => {
    fetchMock.mockResolvedValue(
      userResponse(user({ email: "baru@example.com" })),
    );
    const { result } = renderHook(
      () => ({ register: useRegister(), session: useSession() }),
      { wrapper: hookWrapper() },
    );

    act(() => {
      result.current.register.mutate({ ...credentials, name: "Baru" });
    });
    await waitFor(() => {
      expect(result.current.register.isSuccess).toBe(true);
    });

    expect(result.current.register.data).toEqual(
      user({ email: "baru@example.com" }),
    );
    expect(result.current.session.session).toBeNull();
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(input && requestUrl(input).pathname).toBe("/v1/auth/register");
  });
});

describe("what the auth mutations keep", () => {
  it("useLogin keeps no token at all: its data is empty, and the cache never sees the access token", async () => {
    fetchMock.mockResolvedValue(webSessionResponse(user({ name: "Budi" })));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({ login: useLogin(), session: useSession() }),
      { wrapper: hookWrapper(queryClient) },
    );

    act(() => {
      result.current.login.mutate(credentials);
    });
    await waitFor(() => {
      expect(result.current.login.isSuccess).toBe(true);
    });

    // The session has the token; the mutation (and its cache) does not.
    expect(result.current.session.getAccessToken()).toBe("access-token");
    expect(result.current.login.data).toBeUndefined();
    const kept = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    );
    expect(kept).not.toContain("access-token");
    expect(kept).not.toContain("refresh");
  });

  /** The mutation cache's entries, once the mutation has succeeded and
   *  after its component unmounts. */
  const cacheAroundUnmount = async (
    queryClient: ReturnType<typeof createTestQueryClient>,
    isSuccess: () => boolean,
    unmount: () => void,
  ) => {
    await waitFor(() => {
      expect(isSuccess()).toBe(true);
    });
    const whileMounted = queryClient.getMutationCache().getAll().length;
    unmount();
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
    return whileMounted;
  };

  it("useLogin leaves nothing in the mutation cache after unmount", async () => {
    fetchMock.mockResolvedValue(webSessionResponse());
    const queryClient = createTestQueryClient();
    const { result, unmount } = renderHook(() => useLogin(), {
      wrapper: hookWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(credentials);
    });

    expect(
      await cacheAroundUnmount(
        queryClient,
        () => result.current.isSuccess,
        unmount,
      ),
    ).toBe(1);
  });

  it("useRegister leaves nothing in the mutation cache after unmount", async () => {
    fetchMock.mockResolvedValue(userResponse());
    const queryClient = createTestQueryClient();
    const { result, unmount } = renderHook(() => useRegister(), {
      wrapper: hookWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ ...credentials, name: "Budi" });
    });

    expect(
      await cacheAroundUnmount(
        queryClient,
        () => result.current.isSuccess,
        unmount,
      ),
    ).toBe(1);
  });
});
