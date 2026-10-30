import { useEffect, useId, useRef, useState } from "react";
import type { AdminProduct, AdminProductImage } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { EmptyState } from "@/components/ui/StatusMessage.tsx";
import { usePhotoUploads } from "../hooks/usePhotoUploads.ts";
import { useProcessingPoll } from "../hooks/useProcessingPoll.ts";
import { useDeleteProductImage } from "../hooks/useProductMutations.ts";
import { photoActivitySummary } from "../photo-uploads.ts";
import type { PhotoTile as PhotoTileData } from "../photo-uploads.ts";
import { saveErrorMessage } from "../product-form.ts";
import { PhotoPicker } from "./PhotoPicker.tsx";
import { PhotoTile } from "./PhotoTile.tsx";

interface ProductPhotosSectionProps {
  /** The product as its detail query has it, photos included. */
  product: AdminProduct;
  /** When that query last got data (query.dataUpdatedAt). */
  dataUpdatedAt: number;
}

/**
 * A tile's name: the file the seller chose, or the photo's place. The
 * API's photos come first in the grid, in their order, so a photo's place
 * is its index plus one.
 */
const tileLabel = (tile: PhotoTileData, index: number) =>
  tile.upload?.file.name ?? `Foto ${index + 1}`;

/**
 * "Foto produk" on the edit page: the product's photos, a picker, and
 * every upload on its way (artikel 04).
 *
 * The photos the API has come from the product's detail query; the
 * uploads from usePhotoUploads; the two are merged into one grid, by
 * image ID. While a photo is `processing`, useProcessingPoll refetches the
 * product until it is ready.
 *
 * Deleting a photo the API has asks first (the same ConfirmDialog as
 * archiving): it leaves the storefront and its files are deleted. Taking
 * an upload that has not finished off the list does not ask: nothing the
 * storefront shows is lost.
 *
 * A button that removed its own tile is gone from the page, and the focus
 * would fall to <body>; the section's heading takes it instead, so Tab
 * continues from the photos. The heading is focused in an effect: effects
 * of children run first, so the dialog has closed (and returned the focus
 * to the vanished button) by then.
 *
 * The same for "Unggah ulang", which replaces its tile with a new upload,
 * and for "Periksa lagi", which closes the "lebih lama dari biasanya"
 * alert it is in. (A tile's "Coba lagi" keeps its element: React turns
 * that button into the upload's "Batalkan", and the focus stays on it.)
 */
export function ProductPhotosSection({
  product,
  dataUpdatedAt,
}: ProductPhotosSectionProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { tiles, slotsLeft, addFiles, cancel, retry, reupload } =
    usePhotoUploads(product.id, product.images, dataUpdatedAt);
  const poll = useProcessingPoll(product.id, product.images);
  const remove = useDeleteProductImage(product.id);
  const [toDelete, setToDelete] = useState<
    { image: AdminProductImage; label: string } | undefined
  >(undefined);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) headingRef.current?.focus();
  }, [focusRequest]);
  const focusHeading = () => {
    setFocusRequest((value) => value + 1);
  };

  return (
    <Card as="section" labelledBy={headingId} className="mt-6 grid gap-4">
      <div className="grid gap-1">
        <h2 ref={headingRef} id={headingId} tabIndex={-1}>
          Foto produk
        </h2>
        <p className="text-sm text-muted-foreground">
          JPEG, PNG, atau WebP, paling besar 5 MB dan 6000 piksel per sisi,
          paling banyak 10 foto. Foto tampil di toko setelah selesai diproses,
          biasanya dalam 30 detik; foto pertama yang siap menjadi foto utama.
        </p>
      </div>

      <PhotoPicker slotsLeft={slotsLeft} onFiles={addFiles} />

      {/* Milestones only ("Mengunggah 2 foto."), not every percent. */}
      <p role="status" className="text-sm empty:hidden">
        {photoActivitySummary(tiles)}
      </p>

      {poll.gaveUp && (
        <div role="alert" className="grid justify-items-start gap-2">
          <p>
            Foto masih diproses, lebih lama dari biasanya. Pemrosesan tetap
            berjalan di server; periksa lagi sebentar lagi.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              poll.check();
              focusHeading();
            }}
          >
            Periksa lagi
          </Button>
        </div>
      )}

      {tiles.length === 0 ? (
        <EmptyState>
          Belum ada foto. Pembeli lebih yakin membeli produk yang berfoto.
        </EmptyState>
      ) : (
        <ul
          aria-label="Foto produk"
          className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]"
        >
          {tiles.map((tile, index) => {
            return (
              <PhotoTile
                key={tile.key}
                tile={tile}
                label={tileLabel(tile, index)}
                onDelete={(image, label) => {
                  remove.reset();
                  setToDelete({ image, label });
                }}
                onCancel={(key) => {
                  cancel(key);
                  focusHeading();
                }}
                onRetry={retry}
                onReupload={(key) => {
                  void reupload(key);
                  focusHeading();
                }}
              />
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== undefined}
        title="Hapus foto ini?"
        confirmLabel="Hapus foto"
        destructive
        pending={remove.isPending}
        error={
          remove.isError
            ? saveErrorMessage(
                remove.error,
                "Foto belum terhapus karena kesalahan di server. Coba lagi.",
              )
            : undefined
        }
        onCancel={() => {
          setToDelete(undefined);
        }}
        onConfirm={() => {
          if (toDelete === undefined) return;
          remove.mutate(toDelete.image.id, {
            onSuccess: () => {
              setToDelete(undefined);
              focusHeading();
            },
          });
        }}
      >
        <p>
          {toDelete?.label} dihapus dari toko dan dari penyimpanan. Ini tidak
          dapat dibatalkan.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
