import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionStatus as Status } from "../connection.ts";
import { OrderEventsContext } from "../order-events-context.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { UnreadOrdersBadge } from "./UnreadOrdersBadge.tsx";

const renderWith = ({
  status = "live" as Status,
  unread = 0,
  retryNow = vi.fn(),
}) => {
  render(
    <OrderEventsContext
      value={{
        status,
        retryNow,
        unread,
        toasts: [],
        announcement: "",
        dismissToast: () => undefined,
      }}
    >
      <ConnectionStatus />
      <a href="/pesanan">
        Pesanan
        <UnreadOrdersBadge />
      </a>
    </OrderEventsContext>,
  );
  return retryNow;
};

describe("ConnectionStatus", () => {
  it.each<[Status, string]>([
    ["connecting", "Menyambung…"],
    ["live", "Langsung"],
    ["reconnecting", "Menyambung ulang…"],
  ])("shows %s as '%s', without a retry", (status, label) => {
    renderWith({ status });

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByText("Notifikasi pesanan:", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each<[Status, string, boolean]>([
    ["unreachable", "Notifikasi pesanan tidak dapat dihubungi.", true],
    [
      "too-many-streams",
      "Terlalu banyak tab dasbor terbuka untuk akun ini.",
      true,
    ],
    ["forbidden", "Akun ini tidak boleh menerima notifikasi pesanan.", false],
    [
      "ended",
      "Sesi berakhir. Masuk lagi untuk menerima notifikasi pesanan.",
      false,
    ],
  ])("says %s is down, why, and offers Coba lagi: %s", (status, why, retry) => {
    renderWith({ status });

    const word = screen.getByText("Terputus");
    expect(word).toHaveClass("text-destructive");
    expect(word.parentElement).toHaveTextContent(why);
    expect(screen.queryByRole("button", { name: /Coba lagi/ }) !== null).toBe(
      retry,
    );
  });

  it("retries at once from Coba lagi", async () => {
    const user = userEvent.setup();
    const retryNow = renderWith({ status: "unreachable" });

    await user.click(
      screen.getByRole("button", {
        name: /^Coba lagi\s*menyambung notifikasi$/,
      }),
    );

    expect(retryNow).toHaveBeenCalledTimes(1);
  });

  it("throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<ConnectionStatus />)).toThrow(
      "useOrderEventsContext must be used inside <OrderEventsProvider>",
    );
  });
});

describe("UnreadOrdersBadge", () => {
  it("shows nothing without new orders", () => {
    renderWith({ unread: 0 });

    expect(screen.getByRole("link")).toHaveAccessibleName("Pesanan");
  });

  it("adds the count to the link's name", () => {
    renderWith({ unread: 2 });

    expect(screen.getByRole("link")).toHaveAccessibleName(
      /^Pesanan\s*2\s*pesanan baru$/,
    );
  });

  it.each([
    [99, "99"],
    [100, "99+"],
    [1_000, "99+"],
  ])("shows %d as %s", (unread, shown) => {
    renderWith({ unread });

    expect(screen.getByRole("link")).toHaveTextContent(
      `Pesanan${shown} pesanan baru`,
    );
  });
});
