import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_ID,
  adminProduct,
  user as account,
  webSession,
} from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import { sessionResponse, webRefreshHandler } from "@/test/msw/auth.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  archiveProductHandler,
  productDetailHandler,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { ArchiveProductButton } from "./ArchiveProductButton.tsx";

const renderButton = () => {
  const onArchived = vi.fn();
  server.use(productDetailHandler(adminProduct({ status: "archived" })));
  renderRoute(
    <ArchiveProductButton product={adminProduct()} onArchived={onArchived} />,
  );
  return { onArchived };
};

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Arsipkan" }));
  return screen.getByRole("alertdialog", { name: "Arsipkan “Kaos Polos”?" });
};

describe("ArchiveProductButton", () => {
  it("asks first, saying nothing is deleted and unsaved changes are dropped", async () => {
    const sent = recordRequests();
    const user = userEvent.setup();
    renderButton();

    const dialog = await open(user);

    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveTextContent("Tidak ada yang dihapus");
    expect(dialog).toHaveTextContent(
      "Perubahan di formulir yang belum disimpan akan dibuang.",
    );
    expect(within(dialog).getByRole("button", { name: "Batal" })).toHaveFocus();
    expect(sent).toEqual([]);
  });

  it("closes without archiving from Batal", async () => {
    const sent = recordRequests();
    const user = userEvent.setup();
    const { onArchived } = renderButton();
    const dialog = await open(user);

    await user.click(within(dialog).getByRole("button", { name: "Batal" }));

    expect(dialog).not.toHaveAttribute("open");
    expect(sent).toEqual([]);
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("archives, closes, and tells the page", async () => {
    const sent = recordRequests();
    server.use(archiveProductHandler());
    const user = userEvent.setup();
    const { onArchived } = renderButton();
    const dialog = await open(user);

    await user.click(within(dialog).getByRole("button", { name: "Arsipkan" }));

    await waitFor(() => {
      expect(onArchived).toHaveBeenCalledTimes(1);
    });
    expect(dialog).not.toHaveAttribute("open");
    expect(sent[0]?.method).toBe("DELETE");
    expect(sent[0]?.url.pathname).toBe(`/v1/admin/products/${PRODUCT_ID}`);
  });

  it("waits with both buttons disabled while it runs, ignoring Escape", async () => {
    const answer = deferred<Response>();
    server.use(archiveProductHandler(() => answer.promise));
    const user = userEvent.setup();
    const { onArchived } = renderButton();
    const dialog = await open(user);

    await user.click(within(dialog).getByRole("button", { name: "Arsipkan" }));

    expect(
      await within(dialog).findByRole("button", { name: "Memproses…" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Batal" }),
    ).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).toHaveAttribute("open");
    answer.resolve(new Response(null, { status: 204 }));
    await waitFor(() => {
      expect(onArchived).toHaveBeenCalled();
    });
  });

  it.each([
    [
      500,
      "INTERNAL_ERROR",
      "Produk belum diarsipkan karena kesalahan di server. Coba lagi.",
    ],
    [
      404,
      "NOT_FOUND",
      "Produk ini tidak ditemukan lagi. Kembali ke daftar produk.",
    ],
    [403, "FORBIDDEN", "Akun Anda tidak boleh mengubah produk."],
  ])(
    "keeps the dialog open with the reason after a %d",
    async (status, code, message) => {
      // A 403 makes the session ask once for a fresh role; the answer
      // keeps the role, so the 403 stands. Other failures ask nothing.
      let refreshes = 0;
      server.use(
        archiveProductHandler(() => errorResponse(status, code)),
        webRefreshHandler(() => {
          refreshes += 1;
          return sessionResponse(webSession("token-2", account()));
        }),
      );
      const user = userEvent.setup();
      const { onArchived } = renderButton();
      const dialog = await open(user);

      await user.click(
        within(dialog).getByRole("button", { name: "Arsipkan" }),
      );

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        message,
      );
      expect(dialog).toHaveAttribute("open");
      expect(onArchived).not.toHaveBeenCalled();
      expect(refreshes).toBe(status === 403 ? 1 : 0);
    },
  );

  it("forgets the last failure when opened again", async () => {
    server.use(
      archiveProductHandler(() => errorResponse(500, "INTERNAL_ERROR")),
    );
    const user = userEvent.setup();
    renderButton();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Arsipkan" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));

    await open(user);

    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});
