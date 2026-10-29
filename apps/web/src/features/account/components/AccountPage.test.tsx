import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CART } from "@goshop/shared";
import {
  cartResponse,
  deferred,
  errorResponse,
  fetchMock,
  requestUrl,
  serve,
  user,
} from "@/test/fake-api.ts";
import { createTestQueryClient, renderApp } from "@/test/render.tsx";
import type { Session } from "@/features/auth/session-context.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const budi = user({
  id: "u1",
  name: "Budi Santoso",
  email: "budi@example.com",
  phone: "+6281234567890",
  email_verified: true,
  created_at: "2026-10-01T00:00:00Z",
});
const session: Session = { user: budi, accessToken: "a" };

const meRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/me",
  );

/**
 * GET /v1/me answers with each of `answers` in turn (the last one again
 * after that); the header's cart gets an empty cart.
 */
const serveMe = (...answers: (() => Response | Promise<Response>)[]) => {
  let call = 0;
  serve((url) => {
    if (url.pathname === "/v1/cart") return cartResponse(EMPTY_CART);
    if (url.pathname !== "/v1/me") return undefined;
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return answer?.();
  });
};

/** The value shown next to a term of the account's list. */
const valueOf = (term: string) =>
  screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("AccountPage (/akun)", () => {
  it("shows the account from GET /v1/me, fetched with the access token", async () => {
    serveMe(() => Response.json({ data: budi }));
    const queryClient = createTestQueryClient();
    renderApp("/akun", queryClient, session);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Akun saya" }),
    ).toBeTruthy();
    expect(await screen.findByText("Budi Santoso")).toBeTruthy();
    expect(valueOf("Email")).toBe("budi@example.com");
    expect(valueOf("Telepon")).toBe("+6281234567890");
    expect(valueOf("Bergabung")).toBe("1 Oktober 2026");
    const headers = new Headers(meRequests()[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer a");
    expect(queryClient.getQueryData(["me", "u1"])).toEqual(budi);
  });

  it("says when the email is not verified and the phone is missing", async () => {
    serveMe(() =>
      Response.json({
        data: { ...budi, email_verified: false, phone: null },
      }),
    );
    renderApp("/akun", createTestQueryClient(), session);

    await screen.findByText("Budi Santoso");
    expect(valueOf("Email")).toBe("budi@example.com (belum diverifikasi)");
    expect(valueOf("Telepon")).toBe("Belum diisi");
  });

  it("says Memuat akun… while it loads", async () => {
    const never = deferred<Response>();
    serveMe(() => never.promise);
    renderApp("/akun", createTestQueryClient(), session);

    expect((await screen.findByText("Memuat akun…")).getAttribute("role")).toBe(
      "status",
    );
  });

  it("shows a failed load with Coba lagi, which loads it again", async () => {
    const events = userEvent.setup();
    serveMe(
      () => errorResponse(500, "INTERNAL_ERROR"),
      () => Response.json({ data: budi }),
    );
    renderApp("/akun", createTestQueryClient(), session);

    const alert = await screen.findByRole("alert");
    await act(() =>
      events.click(within(alert).getByRole("button", { name: "Coba lagi" })),
    );

    expect(await screen.findByText("Budi Santoso")).toBeTruthy();
    expect(meRequests()).toHaveLength(2);
  });

  it("sends a guest to /masuk?kembali=/akun without asking the API", async () => {
    const { router } = renderApp("/akun");

    await vi.waitFor(() => {
      expect(router.location.pathname).toBe("/masuk");
    });
    expect(router.location.search).toBe("?kembali=%2Fakun");
    expect(meRequests()).toHaveLength(0);
  });
});
