import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { user } from "@/test/fake-api.ts";
import { inRouter } from "@/test/render.tsx";
import { useSession } from "../session-context.ts";
import { AccountNav } from "./AccountNav.tsx";

/** Logs in as the login page would, for the test. */
function TestLogin() {
  const { setSession } = useSession();
  return (
    <button
      type="button"
      onClick={() => {
        setSession({ user: user({ name: "Siti" }), accessToken: "a" });
      }}
    >
      test-login
    </button>
  );
}

const renderNav = (url = "/") =>
  render(
    inRouter(
      <>
        <TestLogin />
        <ul>
          <AccountNav />
        </ul>
      </>,
      undefined,
      url,
    ),
  );

describe("AccountNav", () => {
  it("offers Masuk and Daftar to a guest, as list items", () => {
    renderNav();

    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Masuk", "/masuk"],
      ["Daftar", "/daftar"],
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks the current auth page", () => {
    renderNav("/daftar");

    expect(
      screen.getByRole("link", { name: "Daftar" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("greets a logged-in buyer and logs out with Keluar", async () => {
    const userEvents = userEvent.setup();
    renderNav();

    await userEvents.click(screen.getByRole("button", { name: "test-login" }));

    expect(screen.getByText("Halo, Siti")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Masuk" })).toBeNull();
    await userEvents.click(screen.getByRole("button", { name: "Keluar" }));

    expect(screen.getByRole("link", { name: "Masuk" })).toBeTruthy();
    expect(screen.queryByText(/Halo/)).toBeNull();
  });
});
