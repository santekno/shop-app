import type { AdminProduct } from "@goshop/shared";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { installFakeXhr } from "@/test/fake-xhr.ts";
import {
  adminImage,
  adminProduct,
  user as account,
  webSession,
} from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import { sessionResponse, webRefreshHandler } from "@/test/msw/auth.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  STORAGE_URL,
  confirmImageHandler,
  deleteImageHandler,
  imageResponse,
  startUploadHandler,
  uploadResponse,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import {
  jpegFile,
  stubImageDecode,
  stubObjectUrls,
} from "@/test/products-photos.ts";
import { renderRoute } from "@/test/render.tsx";
import { ProductPhotosSection } from "./ProductPhotosSection.tsx";

const renderSection = (product: AdminProduct = adminProduct()) =>
  renderRoute(<ProductPhotosSection product={product} dataUpdatedAt={0} />);

const section = () => screen.getByRole("region", { name: "Foto produk" });
const heading = () => screen.getByRole("heading", { name: "Foto produk" });
const tile = (name: string) =>
  within(screen.getByRole("list", { name: "Foto produk" })).getByRole(
    "listitem",
    { name },
  );

describe("ProductPhotosSection", () => {
  it("explains the rules and says there is no photo yet", () => {
    renderSection();

    expect(section()).toHaveTextContent(
      "JPEG, PNG, atau WebP, paling besar 5 MB",
    );
    expect(section()).toHaveTextContent(
      "Belum ada foto. Pembeli lebih yakin membeli produk yang berfoto.",
    );
    expect(screen.queryByRole("list", { name: "Foto produk" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Pilih foto" }),
    ).toHaveAccessibleDescription(
      "Atau tarik foto ke sini. Masih bisa 10 foto lagi.",
    );
  });

  it("leaves the focus alone when it appears", () => {
    renderSection(adminProduct({ images: [adminImage(1)] }));

    expect(heading()).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("lists the photos in order, each named, and counts the slots left", () => {
    renderSection(
      adminProduct({
        images: [adminImage(1), adminImage(2, { status: "processing" })],
      }),
    );

    expect(tile("Foto 1")).toHaveTextContent("Siap, tampil di toko");
    expect(tile("Foto 2")).toHaveTextContent("Diproses untuk toko…");
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 foto sedang diproses.",
    );
    expect(
      screen.getByRole("button", { name: "Pilih foto" }),
    ).toHaveAccessibleDescription(
      "Atau tarik foto ke sini. Masih bisa 8 foto lagi.",
    );
  });

  it("deletes a photo after asking, then puts the focus on the heading", async () => {
    const sent = recordRequests();
    server.use(deleteImageHandler());
    const user = userEvent.setup();
    renderSection(adminProduct({ images: [adminImage(1)] }));

    await user.click(
      within(tile("Foto 1")).getByRole("button", { name: /^Hapus/ }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Hapus foto ini?" });
    expect(dialog).toHaveAccessibleDescription(
      "Foto 1 dihapus dari toko dan dari penyimpanan. Ini tidak dapat dibatalkan.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Hapus foto" }),
    );

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
    expect(heading()).toHaveFocus();
    expect(sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      `DELETE /v1/admin/products/${adminProduct().id}/images/${adminImage(1).id}`,
    ]);
  });

  it("keeps the dialog open with the reason when the delete fails, and forgets it on the next ask", async () => {
    // The 403 makes the session ask for a fresh role; it keeps the role.
    server.use(
      deleteImageHandler(() => errorResponse(403, "FORBIDDEN")),
      webRefreshHandler(() =>
        sessionResponse(webSession("token-2", account())),
      ),
    );
    const user = userEvent.setup();
    renderSection(adminProduct({ images: [adminImage(1)] }));

    await user.click(
      within(tile("Foto 1")).getByRole("button", { name: /^Hapus/ }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Hapus foto ini?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Hapus foto" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Akun Anda tidak boleh mengubah produk.",
    );
    expect(dialog).toHaveAttribute("open");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(dialog).not.toHaveAttribute("open");

    await user.click(
      within(tile("Foto 1")).getByRole("button", { name: /^Hapus/ }),
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("says a server error with the photo's own sentence", async () => {
    server.use(deleteImageHandler(() => errorResponse(500, "INTERNAL_ERROR")));
    const user = userEvent.setup();
    renderSection(adminProduct({ images: [adminImage(1)] }));

    await user.click(
      within(tile("Foto 1")).getByRole("button", { name: /^Hapus/ }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Hapus foto ini?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Hapus foto" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Foto belum terhapus karena kesalahan di server. Coba lagi.",
    );
  });

  it("uploads a chosen file, saying so, and puts the focus on the heading when it is cancelled", async () => {
    stubObjectUrls();
    stubImageDecode();
    const xhrs = installFakeXhr();
    const sent = recordRequests();
    const started = deferred<undefined>();
    server.use(
      startUploadHandler(() => {
        started.resolve(undefined);
        return uploadResponse({
          image: adminImage(7, { status: "pending_upload" }),
          upload: {
            method: "PUT",
            url: `${STORAGE_URL}/products/7`,
            headers: {},
            expires_at: "2099-01-01T00:00:00Z",
          },
        });
      }),
      deleteImageHandler(),
    );
    const user = userEvent.setup();
    const { container } = renderSection();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");

    await user.upload(input, jpegFile("kaos.jpg"));
    await started.promise;
    await waitFor(() => {
      expect(xhrs.instances).toHaveLength(1);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Mengunggah 1 foto.");
    await user.click(
      within(tile("kaos.jpg")).getByRole("button", { name: /^Batalkan/ }),
    );

    expect(heading()).toHaveFocus();
    expect(screen.queryByRole("list", { name: "Foto produk" })).toBeNull();
    // The pending photo is discarded on the server.
    await waitFor(() => {
      expect(sent.map((r) => r.method)).toEqual(["POST", "DELETE"]);
    });
  });

  it("says when processing takes too long, and looks again on Periksa lagi", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    renderSection(
      adminProduct({ images: [adminImage(1, { status: "processing" })] }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(130_000));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Foto masih diproses, lebih lama dari biasanya.",
    );
    const check = within(alert).getByRole("button", { name: "Periksa lagi" });
    check.focus();
    fireEvent.click(check);

    expect(screen.queryByRole("alert")).toBeNull();
    // The button went with its alert: the focus went to the heading.
    expect(heading()).toHaveFocus();
  });

  it("gives the heading the focus when Unggah ulang replaces its tile with a new upload", async () => {
    stubObjectUrls();
    stubImageDecode();
    const xhrs = installFakeXhr();
    let started = 0;
    server.use(
      startUploadHandler(() => {
        started += 1;
        return uploadResponse({
          image: adminImage(6 + started, { status: "pending_upload" }),
          upload: {
            method: "PUT",
            url: `${STORAGE_URL}/products/${String(6 + started)}`,
            headers: {},
            expires_at: "2099-01-01T00:00:00Z",
          },
        });
      }),
      confirmImageHandler(() =>
        imageResponse(adminImage(7, { status: "processing" })),
      ),
      deleteImageHandler(),
    );
    let show: (product: AdminProduct, at: number) => void = () => undefined;
    function Harness() {
      const [state, setState] = useState({ product: adminProduct(), at: 0 });
      show = (product, at) => {
        setState({ product, at });
      };
      return (
        <ProductPhotosSection
          product={state.product}
          dataUpdatedAt={state.at}
        />
      );
    }
    const user = userEvent.setup();
    const { container } = renderRoute(<Harness />);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    await user.upload(input, jpegFile("kaos.jpg"));
    await waitFor(() => {
      expect(xhrs.instances).toHaveLength(1);
    });
    act(() => {
      xhrs.instances[0]?.respond(200);
    });
    await screen.findByText(/diproses/);
    act(() => {
      show(adminProduct({ images: [adminImage(7, { status: "failed" })] }), 1);
    });
    const again = await within(tile("kaos.jpg")).findByRole("button", {
      name: /^Unggah ulang/,
    });
    again.focus();

    await user.keyboard("{Enter}");

    expect(heading()).toHaveFocus();
    // The failed photo deleted, the same file sent again as a new upload.
    await waitFor(() => {
      expect(xhrs.instances).toHaveLength(2);
    });
    expect(again).not.toBeInTheDocument();
    expect(heading()).toHaveFocus();
  });

  it("keeps the focus on the tile's button when Coba lagi turns it back into an upload", async () => {
    stubObjectUrls();
    stubImageDecode();
    const xhrs = installFakeXhr();
    server.use(
      startUploadHandler(() =>
        uploadResponse({
          image: adminImage(7, { status: "pending_upload" }),
          upload: {
            method: "PUT",
            url: `${STORAGE_URL}/products/7`,
            headers: {},
            expires_at: "2099-01-01T00:00:00Z",
          },
        }),
      ),
      // Leaving the page cancels the upload still running.
      deleteImageHandler(),
    );
    const user = userEvent.setup();
    const { container } = renderSection();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    await user.upload(input, jpegFile("kaos.jpg"));
    await waitFor(() => {
      expect(xhrs.instances).toHaveLength(1);
    });
    act(() => {
      xhrs.instances[0]?.fail();
    });
    const retry = await within(tile("kaos.jpg")).findByRole("button", {
      name: /^Coba lagi/,
    });
    retry.focus();

    await user.keyboard("{Enter}");

    // The same URL, sent again: the tile is uploading, with "Batalkan".
    await waitFor(() => {
      expect(xhrs.instances).toHaveLength(2);
    });
    // The same button, now "Batalkan": React kept its element, and the
    // focus with it. Nothing to move.
    expect(retry).toHaveFocus();
    expect(retry).toHaveAccessibleName(/^Batalkan\s*kaos\.jpg$/);
  });
});
