import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { session, user } from "@/test/fixtures.ts";
import { deferred, noContent } from "@/test/msw/answers.ts";
import { webLogoutHandler } from "@/test/msw/auth.ts";
import { errorResponse } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import { Providers } from "@/test/providers.tsx";
import { useSession } from "../session-context.ts";
import type { SessionValue } from "../session-context.ts";
import { UserMenu } from "./UserMenu.tsx";

/** The menu, and a handle on the session to change the role from outside. */
const renderMenu = (role: "seller" | "admin" = "seller") => {
  const handle: { current: SessionValue | null } = { current: null };
  function Probe() {
    handle.current = useSession();
    return handle.current.status === "authenticated" ? (
      <UserMenu />
    ) : (
      <p>Keluar berhasil</p>
    );
  }
  render(
    <Providers
      queryClient={createQueryClient()}
      session={session(role, "t", {
        name: "Sari Wulandari",
        email: "sari@goshop.test",
      })}
    >
      <Probe />
    </Providers>,
  );
  return handle;
};

const trigger = () => screen.getByRole("button", { name: /Sari Wulandari/ });

describe("UserMenu", () => {
  it("shows the name and the role on its button", () => {
    renderMenu("seller");

    expect(trigger()).toHaveTextContent("Sari Wulandari");
    expect(trigger()).toHaveTextContent("(Penjual)");
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
  });

  it("opens a menu with the name, the email, the role and Keluar", async () => {
    const userEvents = userEvent.setup();
    renderMenu("admin");

    await userEvents.click(trigger());

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("Sari Wulandari");
    expect(menu).toHaveTextContent("sari@goshop.test");
    expect(menu).toHaveTextContent("Peran: Admin");
    expect(
      within(menu).getByRole("menuitem", { name: "Keluar" }),
    ).toBeInTheDocument();
  });

  it("logs out from the menu", async () => {
    server.use(webLogoutHandler(() => noContent()));
    const userEvents = userEvent.setup();
    renderMenu();

    await userEvents.click(trigger());
    await userEvents.click(
      await screen.findByRole("menuitem", { name: "Keluar" }),
    );

    expect(await screen.findByText("Keluar berhasil")).toBeInTheDocument();
  });

  it("disables its button while the logout runs", async () => {
    const answer = deferred<Response>();
    server.use(webLogoutHandler(() => answer.promise));
    const userEvents = userEvent.setup();
    renderMenu();

    await userEvents.click(trigger());
    await userEvents.click(
      await screen.findByRole("menuitem", { name: "Keluar" }),
    );

    await waitFor(() => {
      expect(trigger()).toBeDisabled();
    });
    answer.resolve(noContent());
    expect(await screen.findByText("Keluar berhasil")).toBeInTheDocument();
  });

  it("keeps the user logged in and says so when the logout fails", async () => {
    server.use(webLogoutHandler(() => errorResponse(500, "INTERNAL_ERROR")));
    const userEvents = userEvent.setup();
    renderMenu();

    await userEvents.click(trigger());
    await userEvents.click(
      await screen.findByRole("menuitem", { name: "Keluar" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Gagal keluar. Periksa koneksi Anda, lalu coba lagi.",
    );
    expect(trigger()).toBeEnabled();
  });

  it("throws outside a session: it only belongs under RequireStaff", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      render(
        <Providers queryClient={createQueryClient()} session={null}>
          <UserMenu />
        </Providers>,
      ),
    ).toThrow("useSessionUser must be used under <RequireStaff>");
  });

  describe("when the role changes during the session (artikel 08)", () => {
    it("says so politely, and Tutup hands the focus back to the menu", async () => {
      const userEvents = userEvent.setup();
      const handle = renderMenu("admin");
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("");
      expect(
        screen.queryByRole("button", { name: "Tutup pemberitahuan peran" }),
      ).toBeNull();

      act(() => {
        handle.current?.setSession({
          user: user({ name: "Sari Wulandari", role: "seller" }),
          accessToken: "t2",
        });
      });

      expect(status).toHaveTextContent(
        "Peran Anda berubah dari Admin menjadi Penjual. Tindakan yang tersedia sudah disesuaikan.",
      );
      await userEvents.click(
        screen.getByRole("button", { name: "Tutup pemberitahuan peran" }),
      );
      expect(status).toHaveTextContent("");
      expect(trigger()).toHaveFocus();
    });

    it("says nothing for a new token with the same role", () => {
      const handle = renderMenu("seller");

      act(() => {
        handle.current?.setSession({
          user: user({ name: "Sari Wulandari", role: "seller" }),
          accessToken: "t2",
        });
      });

      expect(screen.getByRole("status")).toHaveTextContent("");
    });

    it("tells the latest change after two", () => {
      const handle = renderMenu("seller");

      act(() => {
        handle.current?.setSession({
          user: user({ name: "Sari Wulandari", role: "admin" }),
          accessToken: "t2",
        });
      });
      act(() => {
        handle.current?.setSession({
          user: user({ name: "Sari Wulandari", role: "seller" }),
          accessToken: "t3",
        });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "Peran Anda berubah dari Admin menjadi Penjual.",
      );
    });
  });
});
