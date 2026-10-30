import type { AdminProduct } from "@goshop/shared";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { installFakeXhr } from "@/test/fake-xhr.ts";
import { adminImage, adminProduct } from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  STORAGE_URL,
  deleteImageHandler,
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
    server.use(deleteImageHandler(() => errorResponse(403, "FORBIDDEN")));
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
    fireEvent.click(
      within(alert).getByRole("button", { name: "Periksa lagi" }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
