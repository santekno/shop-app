import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@goshop/shared";
import {
  deferred,
  errorResponse,
  fetchMock,
  noContentResponse,
  requestUrl,
  user,
  webSessionResponse,
} from "@/test/fake-api.ts";
import { SessionProvider } from "./SessionProvider.tsx";
import { useSession } from "./session-context.ts";
import type { Session, SessionStatus } from "./session-context.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const budi: Session = { user: user(), accessToken: "a" };

interface Props {
  initialSession?: Session | null;
  onStart?: (client: ApiClient, session: Session) => Promise<void>;
  onEnd?: () => void;
  strict?: boolean;
}

const wrapperWith =
  ({ strict = false, ...props }: Props = {}) =>
  ({ children }: { children: ReactNode }) => {
    const tree = <SessionProvider {...props}>{children}</SessionProvider>;
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };

const refreshCalls = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/auth/web/refresh",
  );

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionProvider: the start-up restore", () => {
  it("is restoring until the refresh answers, then authenticated", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith(),
    });

    expect(result.current.status).toBe("restoring");
    expect(result.current.session).toBeNull();
    expect(result.current.getAccessToken()).toBeNull();

    await act(async () => {
      answer.resolve(webSessionResponse(user({ name: "Siti" }), "restored"));
      await result.current.ready();
    });

    expect(result.current.status).toBe("authenticated");
    expect(result.current.session).toEqual({
      user: user({ name: "Siti" }),
      accessToken: "restored",
    });
    expect(result.current.getAccessToken()).toBe("restored");
    const [, init] = refreshCalls()[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
  });

  it.each([
    ["no cookie (204)", () => noContentResponse()],
    ["a refused cookie (401)", () => errorResponse(401, "TOKEN_INVALID")],
    ["a server error", () => errorResponse(500, "INTERNAL_ERROR")],
  ])("is anonymous after %s", async (_name, answer) => {
    fetchMock.mockImplementation(() => Promise.resolve(answer()));
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    expect(result.current.session).toBeNull();
  });

  it("sends the cookie once under StrictMode's double effect", async () => {
    fetchMock.mockResolvedValue(webSessionResponse());
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ strict: true }),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    expect(refreshCalls()).toHaveLength(1);
  });

  it("runs onStart with the new session before it is published", async () => {
    fetchMock.mockResolvedValue(webSessionResponse());
    // What the rest of the app could see while onStart ran.
    const seen: { status: SessionStatus; token: string | null }[] = [];
    const reader: { read?: () => (typeof seen)[number] } = {};
    const onStart = vi.fn<
      (client: ApiClient, session: Session) => Promise<void>
    >(() => {
      if (reader.read !== undefined) seen.push(reader.read());
      return Promise.resolve();
    });
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ onStart }),
    });
    reader.read = () => ({
      status: result.current.status,
      token: result.current.getAccessToken(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]?.[1]).toEqual({
      user: user(),
      accessToken: "access-token",
    });
    // Not published yet: no status change and no token for other requests.
    expect(seen).toEqual([{ status: "restoring", token: null }]);
  });

  it("asks nothing with initialSession null: a guest at once", () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ initialSession: null }),
    });

    expect(result.current.status).toBe("anonymous");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks nothing with an initialSession: logged in at once", async () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ initialSession: budi }),
    });

    expect(result.current.status).toBe("authenticated");
    expect(result.current.session).toBe(budi);
    expect(result.current.getAccessToken()).toBe("a");
    await expect(result.current.ready()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SessionProvider and useSession", () => {
  it("keep the session that is set, and narrow it by status", () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ initialSession: null }),
    });
    expect(result.current.session).toBeNull();

    act(() => {
      result.current.setSession(budi);
    });
    expect(result.current.status).toBe("authenticated");
    expect(result.current.session).toEqual(budi);

    act(() => {
      result.current.setSession(null);
    });
    expect(result.current.status).toBe("anonymous");
    expect(result.current.session).toBeNull();
  });

  it("update getAccessToken at once, before React renders again", () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ initialSession: null }),
    });
    const { setSession, getAccessToken, getSession } = result.current;
    let seen: string | null = "not read";

    act(() => {
      setSession({ user: user(), accessToken: "new" });
      seen = getAccessToken();
    });

    expect(seen).toBe("new");
    expect(getSession()?.accessToken).toBe("new");
  });

  it("keep the same value object while the session does not change", () => {
    const { result, rerender } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ initialSession: budi }),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("give a new value on a session change, with the same functions", () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ initialSession: null }),
    });
    const first = result.current;

    act(() => {
      result.current.setSession(budi);
    });

    expect(result.current).not.toBe(first);
    expect(result.current.login).toBe(first.login);
    expect(result.current.logout).toBe(first.logout);
    expect(result.current.getAccessToken).toBe(first.getAccessToken);
    expect(result.current.authApi).toBe(first.authApi);
    expect(result.current.ready).toBe(first.ready);
  });

  it("run onEnd after a logout ends a real session", async () => {
    fetchMock.mockResolvedValue(noContentResponse());
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperWith({ initialSession: budi, onEnd }),
    });

    await act(() => result.current.logout());

    expect(result.current.status).toBe("anonymous");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("make useSession throw outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useSession())).toThrow(
      "useSession must be used inside <SessionProvider>",
    );
  });
});
