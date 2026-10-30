import type { AdminProductImage } from "@goshop/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { adminImage } from "@/test/fixtures.ts";
import { jpegFile } from "@/test/products-photos.ts";
import { newPhotoUpload } from "../photo-uploads.ts";
import type {
  PhotoTile as PhotoTileData,
  PhotoUpload,
} from "../photo-uploads.ts";
import { PhotoTile } from "./PhotoTile.tsx";

const upload = (overrides: Partial<PhotoUpload> = {}): PhotoUpload => ({
  ...newPhotoUpload("k1", jpegFile("kaos.jpg", 2_000), "blob:preview"),
  ...overrides,
});

const renderTile = (tile: PhotoTileData, label = "kaos.jpg") => {
  const handlers = {
    onDelete: vi.fn<(image: AdminProductImage, label: string) => void>(),
    onCancel: vi.fn<(key: string) => void>(),
    onRetry: vi.fn<(key: string) => void>(),
    onReupload: vi.fn<(key: string) => void>(),
  };
  render(
    <ul>
      <PhotoTile tile={tile} label={label} {...handlers} />
    </ul>,
  );
  const item = screen.getByRole("listitem", { name: label });
  return { ...handlers, item };
};

/**
 * A button's name: its word and the tile's label (sr-only). The DOM
 * accessibility library drops the space before the sr-only part, so the
 * pattern allows either.
 */
const named = (word: string, label: string) =>
  new RegExp(`^${word}\\s*${label.replace(".", "\\.")}$`);

/**
 * The tile's picture. Decorative (alt=""): a screen reader skips it, so
 * no role finds it; the tile's caption names the photo instead.
 */
const picture = (item: HTMLElement) => {
  const img = item.querySelector("img");
  if (img === null) throw new Error("no picture");
  return img;
};

const buttons = (item: HTMLElement) =>
  within(item)
    .queryAllByRole("button")
    .map((button) => button.textContent.replace(/\s+/g, " "));

describe("PhotoTile", () => {
  it.each([
    ["checking", "Memeriksa berkas…"],
    ["queued", "Menunggu giliran"],
    ["starting", "Menyiapkan unggahan…"],
  ] as const)("says %s and offers to cancel it", async (phase, text) => {
    const user = userEvent.setup();
    const { item, onCancel } = renderTile({
      key: "k1",
      upload: upload({ phase }),
    });

    expect(item).toHaveTextContent(text);
    expect(picture(item)).toHaveAttribute("src", "blob:preview");
    await user.click(
      within(item).getByRole("button", { name: named("Batalkan", "kaos.jpg") }),
    );
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("k1");
  });

  it("shows the bytes sent as a named progress bar and a percentage", () => {
    const { item } = renderTile({
      key: "k1",
      upload: upload({ phase: "uploading", loaded: 700, total: 2_000 }),
    });

    const bar = within(item).getByRole("progressbar", {
      name: "Mengunggah kaos.jpg",
    });
    expect(bar).toHaveAttribute("value", "35");
    expect(item).toHaveTextContent("Mengunggah 35%");
    expect(buttons(item)).toEqual(["Batalkan kaos.jpg"]);
  });

  it("offers nothing while the server checks the photo", () => {
    const { item } = renderTile({
      key: "k1",
      upload: upload({ phase: "confirming" }),
    });

    expect(item).toHaveTextContent("Memeriksa di server…");
    expect(buttons(item)).toEqual([]);
  });

  it("says why a file was refused, aloud, without its preview, and closes it", async () => {
    const user = userEvent.setup();
    const { item, onCancel } = renderTile({
      key: "k1",
      upload: upload({ phase: "rejected", message: "Bukan foto." }),
    });

    expect(within(item).getByRole("alert")).toHaveTextContent("Bukan foto.");
    expect(item.querySelector("img")).toBeNull();
    await user.click(
      within(item).getByRole("button", { name: named("Tutup", "kaos.jpg") }),
    );
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("k1");
  });

  it("offers Coba lagi and Hapus for a failure that can be retried", async () => {
    const user = userEvent.setup();
    const { item, onRetry, onCancel } = renderTile({
      key: "k1",
      upload: upload({
        phase: "failed",
        message: "Penyimpanan bermasalah.",
        retryable: true,
      }),
    });

    expect(within(item).getByRole("alert")).toHaveTextContent(
      "Penyimpanan bermasalah.",
    );
    await user.click(
      within(item).getByRole("button", {
        name: named("Coba lagi", "kaos.jpg"),
      }),
    );
    await user.click(
      within(item).getByRole("button", { name: named("Hapus", "kaos.jpg") }),
    );
    expect(onRetry).toHaveBeenCalledExactlyOnceWith("k1");
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("k1");
  });

  it("offers only Hapus for a failure no retry can fix", () => {
    const { item } = renderTile({
      key: "k1",
      upload: upload({ phase: "failed", message: "Rusak.", retryable: false }),
    });

    expect(buttons(item)).toEqual(["Hapus kaos.jpg"]);
  });

  it("shows a ready photo from its sizes, alt empty, deletable", async () => {
    const user = userEvent.setup();
    const image = adminImage(1, {
      variants: [
        { width: 400, height: 400, url: "http://x/400.jpg" },
        { width: 800, height: 800, url: "http://x/800.jpg" },
      ],
    });
    const { item, onDelete } = renderTile({ key: image.id, image }, "Foto 1");

    const img = picture(item);
    expect(img).toHaveAttribute("src", "http://x/400.jpg");
    expect(img).toHaveAttribute(
      "srcset",
      "http://x/400.jpg 400w, http://x/800.jpg 800w",
    );
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "1200");
    expect(item).toHaveTextContent("Siap, tampil di toko");
    await user.click(
      within(item).getByRole("button", { name: named("Hapus", "Foto 1") }),
    );
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(image, "Foto 1");
  });

  it("shows the preview of a confirmed upload while the server processes it", () => {
    const image = adminImage(1, {
      status: "processing",
      variants: [],
      url: null,
    });
    const { item } = renderTile({
      key: image.id,
      image,
      upload: upload({ phase: "confirmed" }),
    });

    expect(item).toHaveTextContent("Diproses untuk toko…");
    expect(picture(item)).toHaveAttribute("src", "blob:preview");
    expect(buttons(item)).toEqual(["Hapus kaos.jpg"]);
  });

  it("shows no picture for a ready photo whose sizes are not listed", () => {
    const image = adminImage(1, { variants: [] });
    const { item } = renderTile({ key: image.id, image }, "Foto 4");

    expect(item.querySelector("img")).toBeNull();
    expect(item).toHaveTextContent("Siap, tampil di toko");
  });

  it("shows no picture for a processing photo without a preview", () => {
    const image = adminImage(1, { status: "processing", variants: [] });
    const { item } = renderTile({ key: image.id, image }, "Foto 2");

    expect(item.querySelector("img")).toBeNull();
    expect(item).toHaveTextContent("Diproses untuk toko…");
  });

  it("says a photo was never finished uploading, deletable", () => {
    const image = adminImage(1, { status: "pending_upload", variants: [] });
    const { item } = renderTile({ key: image.id, image }, "Foto 3");

    expect(item).toHaveTextContent("Belum selesai diunggah");
    expect(buttons(item)).toEqual(["Hapus Foto 3"]);
  });

  it("offers to upload again and to delete a photo the server could not process", async () => {
    const user = userEvent.setup();
    const image = adminImage(1, { status: "failed", variants: [] });
    const { item, onReupload, onDelete } = renderTile({
      key: image.id,
      image,
      upload: upload({ phase: "confirmed" }),
    });

    expect(item).toHaveTextContent(
      "Gagal diproses: server tidak dapat mengolah foto ini.",
    );
    await user.click(
      within(item).getByRole("button", {
        name: named("Unggah ulang", "kaos.jpg"),
      }),
    );
    await user.click(
      within(item).getByRole("button", { name: named("Hapus", "kaos.jpg") }),
    );
    expect(onReupload).toHaveBeenCalledExactlyOnceWith("k1");
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(image, "kaos.jpg");
  });

  it("offers only to delete a failed photo that was not uploaded in this visit", () => {
    const image = adminImage(1, { status: "failed", variants: [] });
    const { item } = renderTile({ key: image.id, image }, "Foto 1");

    expect(buttons(item)).toEqual(["Hapus Foto 1"]);
  });
});
