import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  errorResponse,
  fetchMock,
  noContentResponse,
  requestUrl,
  user,
} from "@/test/fake-api.ts";
import { currentLocation, inRouter } from "@/test/render.tsx";
import type { TestSession } from "@/test/render.tsx";
import { useSession } from "../session-context.ts";
import type { SessionValue } from "../session-context.ts";
import { AccountNav } from "./AccountNav.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const siti = { user: user({ name: "Siti" }), accessToken: "a" };

/** Hands the test the session value, to change it from outside the nav. */
let sessionValue: SessionValue | undefined;
function SessionSpy() {
  const value = useSession();
  useEffect(() => {
    sessionValue = value;
  });
  return null;
}
const currentSession = () => {
  if (sessionValue === undefined) throw new Error("no session yet");
  return sessionValue;
};

const renderNav = (url = "/", session: TestSession = null) =>
  render(
    inRouter(
      <>
        <SessionSpy />
        <ul>
          <AccountNav />
        </ul>
      </>,
      undefined,
      url,
      session,
    ),
  );

const logoutRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/auth/web/logout",
  );

/** Opens the account menu under the buyer's name. */
const openMenu = async (events: ReturnType<typeof userEvent.setup>) => {
  await events.click(
    await screen.findByRole("button", { name: /^Halo, Siti/ }),
  );
  return screen.findByRole("menu");
};

beforeEach(() => {
  fetchMock.mockReset();
  sessionValue = undefined;
});

describe("AccountNav", () => {
  it("offers Masuk and Daftar to a guest, as list items", () => {
    renderNav();

    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Masuk", "/masuk"],
      ["Daftar", "/daftar"],
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // A guest's first visit: nothing moves the focus.
    expect(document.activeElement).toBe(document.body);
  });

  it("marks the current auth page", () => {
    renderNav("/daftar");

    expect(
      screen.getByRole("link", { name: "Daftar" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("renders nothing while the session is being restored, then Masuk", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    const { container } = renderNav("/", "restore");

    expect(container.querySelector("ul")?.innerHTML).toBe("");
    expect(screen.queryByRole("link", { name: "Masuk" })).toBeNull();
    expect(screen.queryByText(/Halo/)).toBeNull();

    // No cookie: a guest.
    await act(async () => {
      answer.resolve(noContentResponse());
      await answer.promise;
    });
    expect(await screen.findByRole("link", { name: "Masuk" })).toBeTruthy();
  });

  it("greets a logged-in buyer with a menu: the email, Akun saya and Keluar", async () => {
    const events = userEvent.setup();
    renderNav("/", siti);

    expect(screen.queryByRole("link", { name: "Masuk" })).toBeNull();
    const menu = await openMenu(events);

    expect(menu.textContent).toContain("budi@example.com");
    const account = screen.getByRole("menuitem", { name: "Akun saya" });
    expect(account.tagName).toBe("A");
    expect(account.getAttribute("href")).toBe("/akun");
    expect(screen.getByRole("menuitem", { name: "Keluar" })).toBeTruthy();
  });

  it("opens Akun saya from the menu", async () => {
    const events = userEvent.setup();
    renderNav("/", siti);

    await openMenu(events);
    await events.click(screen.getByRole("menuitem", { name: "Akun saya" }));

    expect(currentLocation()).toBe("/akun");
  });

  it("logs out with Keluar through the web endpoint, then gives the focus to Masuk", async () => {
    const events = userEvent.setup();
    fetchMock.mockResolvedValue(noContentResponse());
    renderNav("/", siti);

    await openMenu(events);
    await events.click(screen.getByRole("menuitem", { name: "Keluar" }));

    const masuk = await screen.findByRole("link", { name: "Masuk" });
    expect(screen.queryByText(/Halo/)).toBeNull();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(masuk);
    });
    expect(logoutRequests()).toHaveLength(1);
    const [, init] = logoutRequests()[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(currentSession().status).toBe("anonymous");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the session and says so when the logout fails", async () => {
    const events = userEvent.setup();
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR"));
    renderNav("/", siti);

    await openMenu(events);
    await events.click(screen.getByRole("menuitem", { name: "Keluar" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Gagal keluar. Periksa koneksi Anda, lalu coba lagi.",
    );
    expect(currentSession().status).toBe("authenticated");
    expect(screen.getByRole("button", { name: /^Halo, Siti/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Masuk" })).toBeNull();
  });

  it("moves the focus to Masuk only after Keluar, not when the session ends otherwise", async () => {
    const events = userEvent.setup();
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR"));
    renderNav("/", siti);

    // A failed Keluar forgets that it wanted to move the focus.
    await openMenu(events);
    await events.click(screen.getByRole("menuitem", { name: "Keluar" }));
    await screen.findByRole("alert");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    // The session then ends some other way (a refused refresh, say).
    act(() => {
      currentSession().setSession(null);
    });

    expect(screen.getByRole("link", { name: "Masuk" })).toBeTruthy();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("hides the failure message again when a second Keluar works", async () => {
    const events = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR"))
      .mockResolvedValueOnce(noContentResponse());
    renderNav("/", siti);

    await openMenu(events);
    await events.click(screen.getByRole("menuitem", { name: "Keluar" }));
    await screen.findByRole("alert");
    await openMenu(events);
    await events.click(screen.getByRole("menuitem", { name: "Keluar" }));

    expect(await screen.findByRole("link", { name: "Masuk" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(logoutRequests()).toHaveLength(2);
  });
});
