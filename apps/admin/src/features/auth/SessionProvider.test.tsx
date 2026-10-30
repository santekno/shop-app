import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { session, user, webSession } from "@/test/fixtures.ts";
import { deferred, noContent } from "@/test/msw/answers.ts";
import {
  sessionResponse,
  webLoginHandler,
  webLogoutHandler,
  webRefreshHandler,
} from "@/test/msw/auth.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import { Providers } from "@/test/providers.tsx";
import type { TestSession } from "@/test/providers.tsx";
import { useLogin } from "./hooks/useLogin.ts";
import { useLogout } from "./hooks/useLogout.ts";
import { useSession, useSessionUser } from "./session-context.ts";

const renderSession = (who: TestSession, onEnd?: () => void) => {
  const queryClient = createQueryClient();
  return {
    queryClient,
    ...renderHook(() => useSession(), {
      wrapper: ({ children }) => (
        <Providers queryClient={queryClient} session={who} onEnd={onEnd}>
          {children}
        </Providers>
      ),
    }),
  };
};

describe("SessionProvider", () => {
  it("starts restoring and asks the API once, as the dashboard", async () => {
    const sent = recordRequests();
    server.use(
      webRefreshHandler(() => sessionResponse(webSession("restored", user()))),
    );
    const { result } = renderSession("restore");

    expect(result.current.status).toBe("restoring");
    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });

    expect(result.current.session).toEqual({
      user: user(),
      accessToken: "restored",
    });
    expect(
      sent.map((r) => [r.url.pathname, r.headers.get("X-GoShop-Client")]),
    ).toEqual([["/v1/auth/web/refresh", "admin"]]);
  });

  it("becomes anonymous when there is no cookie", async () => {
    server.use(webRefreshHandler(() => noContent()));
    const { result } = renderSession("restore");

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    expect(result.current.session).toBeNull();
  });

  it("asks nothing for a session given at the start", () => {
    const sent = recordRequests();
    const { result } = renderSession(session("admin", "given"));

    expect(result.current.status).toBe("authenticated");
    expect(result.current.getAccessToken()).toBe("given");
    expect(sent).toEqual([]);
  });

  it("resolves ready() once the restore has settled", async () => {
    const answer = deferred<Response>();
    server.use(webRefreshHandler(() => answer.promise));
    const { result } = renderSession("restore");
    const ready = vi.fn();
    void result.current.ready().then(ready);

    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    answer.resolve(noContent());

    await waitFor(() => {
      expect(ready).toHaveBeenCalled();
    });
  });

  it("keeps the same actions across session changes", () => {
    const { result } = renderSession(session());
    const { authApi, login, tokens } = result.current;

    act(() => {
      result.current.setSession(session("admin", "other"));
    });

    expect(result.current.session?.user.role).toBe("admin");
    expect(result.current.authApi).toBe(authApi);
    expect(result.current.login).toBe(login);
    expect(result.current.tokens).toBe(tokens);
    expect(result.current.getSession()?.accessToken).toBe("other");
  });

  it("sends the session's token with authApi", async () => {
    const sent = recordRequests();
    server.use(
      webRefreshHandler(() => sessionResponse(webSession("restored", user()))),
    );
    const { http, HttpResponse } = await import("msw");
    const { API_URL } = await import("@/test/msw/http.ts");
    server.use(
      http.get(`${API_URL}/v1/admin/x`, () => HttpResponse.json({ ok: true })),
    );
    const { result } = renderSession(session("seller", "given"));

    await result.current.authApi.request("/v1/admin/x");

    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer given");
  });

  it("runs onEnd after a logout, and only then", async () => {
    server.use(webLogoutHandler(() => noContent()));
    const onEnd = vi.fn();
    const { result } = renderSession(session(), onEnd);

    expect(onEnd).not.toHaveBeenCalled();
    await act(() => result.current.logout());

    expect(result.current.status).toBe("anonymous");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("useSession and useSessionUser", () => {
  it("useSession throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useSession())).toThrow(
      "useSession must be used inside <SessionProvider>",
    );
  });

  it("useSessionUser is the logged-in account", () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useSessionUser(), {
      wrapper: ({ children }) => (
        <Providers queryClient={queryClient} session={session("admin")}>
          {children}
        </Providers>
      ),
    });

    expect(result.current).toEqual(user({ role: "admin" }));
  });

  it("useSessionUser throws without a session", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Probe() {
      useSessionUser();
      return null;
    }
    expect(() =>
      render(
        <Providers queryClient={createQueryClient()} session={null}>
          <Probe />
        </Providers>,
      ),
    ).toThrow("useSessionUser must be used under <RequireStaff>");
  });
});

describe("useLogin", () => {
  it("logs in, keeps no token in the mutation, and drops the password once the page is left", async () => {
    server.use(webLoginHandler(() => sessionResponse(webSession("t", user()))));
    const queryClient = createQueryClient();
    const { result, unmount } = renderHook(
      () => ({ login: useLogin(), session: useSession() }),
      {
        wrapper: ({ children }) => (
          <Providers queryClient={queryClient} session={null}>
            {children}
          </Providers>
        ),
      },
    );

    await act(() =>
      result.current.login.mutateAsync({ email: "a@b.c", password: "rahasia" }),
    );

    expect(result.current.session.status).toBe("authenticated");
    expect(result.current.login.data).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()[0]?.state.variables).toEqual(
      {
        email: "a@b.c",
        password: "rahasia",
      },
    );

    // gcTime 0: gone as soon as nothing observes it.
    unmount();
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
  });

  it("is in error with the API's error when the login fails", async () => {
    server.use(
      webLoginHandler(() => errorResponse(401, "INVALID_CREDENTIALS")),
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useLogin(), {
      wrapper: ({ children }) => (
        <Providers queryClient={queryClient} session={null}>
          {children}
        </Providers>
      ),
    });

    act(() => {
      result.current.mutate({ email: "a@b.c", password: "x" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});

describe("useLogout", () => {
  it("is in error and keeps the session when the API refuses", async () => {
    server.use(webLogoutHandler(() => errorResponse(500, "INTERNAL_ERROR")));
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => ({ logout: useLogout(), session: useSession() }),
      {
        wrapper: ({ children }) => (
          <Providers queryClient={queryClient} session={session()}>
            {children}
          </Providers>
        ),
      },
    );

    act(() => {
      result.current.logout.mutate();
    });

    await waitFor(() => {
      expect(result.current.logout.isError).toBe(true);
    });
    expect(result.current.session.status).toBe("authenticated");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
