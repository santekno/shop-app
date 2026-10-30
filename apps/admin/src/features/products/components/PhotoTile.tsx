import { useId } from "react";
import { FileWarning, ImageOff, LoaderCircle } from "lucide-react";
import type { AdminProductImage } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Progress } from "@/components/ui/Progress.tsx";
import { photoTileStatus } from "../photo-uploads.ts";
import type {
  PhotoTile as PhotoTileData,
  PhotoTileStatus,
} from "../photo-uploads.ts";

interface PhotoTileProps {
  tile: PhotoTileData;
  /** What the tile is called: the file's name, or "Foto 3". */
  label: string;
  /** "Hapus" on a photo the API has: the page asks first. */
  onDelete: (image: AdminProductImage, label: string) => void;
  /** "Batalkan" / "Hapus" / "Tutup" on a local upload: no question needed. */
  onCancel: (key: string) => void;
  onRetry: (key: string) => void;
  onReupload: (key: string) => void;
}

/** The photo itself: the API's sizes once ready, the local preview before. */
function TilePicture({
  image,
  previewUrl,
  status,
}: {
  image: AdminProductImage | undefined;
  previewUrl: string | undefined;
  status: PhotoTileStatus;
}) {
  // alt="": the tile's caption (the file name or "Foto 3") and its status
  // are text next to the picture; a screen reader cannot judge the photo,
  // and the caption already names it.
  const pictureClass = "size-full object-cover";
  if (image?.status === "ready" && image.variants.length > 0) {
    return (
      <img
        src={image.variants[0]?.url ?? image.url ?? undefined}
        srcSet={image.variants
          .map((variant) => `${variant.url} ${variant.width}w`)
          .join(", ")}
        // Two columns on a phone, a tile of about 11rem from `sm` up.
        sizes="(min-width: 640px) 11rem, 50vw"
        alt=""
        width={image.width ?? undefined}
        height={image.height ?? undefined}
        loading="lazy"
        decoding="async"
        className={pictureClass}
      />
    );
  }
  if (
    previewUrl !== undefined &&
    previewUrl !== "" &&
    status.kind !== "rejected"
  ) {
    // An object URL (blob:…) of the chosen file: shown before a byte is
    // uploaded, and until the API's sizes are ready.
    return <img src={previewUrl} alt="" className={pictureClass} />;
  }
  const Icon = status.kind === "rejected" ? FileWarning : ImageOff;
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground">
      <Icon aria-hidden="true" className="size-8" />
    </div>
  );
}

/** The status line under the picture. */
function TileStatus({
  status,
  label,
}: {
  status: PhotoTileStatus;
  label: string;
}) {
  switch (status.kind) {
    case "checking":
      return <p className="text-sm text-muted-foreground">Memeriksa berkas…</p>;
    case "queued":
      return <p className="text-sm text-muted-foreground">Menunggu giliran</p>;
    case "starting":
      return (
        <p className="text-sm text-muted-foreground">Menyiapkan unggahan…</p>
      );
    case "uploading":
      return (
        <div className="grid gap-1">
          <Progress
            value={status.percent}
            max={100}
            aria-label={`Mengunggah ${label}`}
          />
          <p className="text-sm text-muted-foreground">
            Mengunggah {status.percent}%
          </p>
        </div>
      );
    case "confirming":
      return (
        <p className="text-sm text-muted-foreground">Memeriksa di server…</p>
      );
    case "processing":
      return (
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          Diproses untuk toko…
        </p>
      );
    case "ready":
      return (
        // whitespace-normal: a badge never wraps by default, and in a
        // narrow tile (two columns on a phone) it would push the tile wider.
        <Badge variant="success" className="whitespace-normal">
          Siap, tampil di toko
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="outline" className="whitespace-normal">
          Belum selesai diunggah
        </Badge>
      );
    case "processing-failed":
      return (
        <p className="text-sm text-destructive">
          Gagal diproses: server tidak dapat mengolah foto ini.
        </p>
      );
    case "rejected":
    case "failed":
      // role="alert": the seller hears why at once, whichever file it was.
      return (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      );
  }
}

/**
 * One photo of the grid: the picture, its name, where it is (a progress
 * bar while it uploads), and what can be done with it now.
 *
 * Every button names its photo for a screen reader ("Hapus foto-1.jpg"):
 * ten "Hapus" buttons in a list are otherwise ten identical stops. The
 * name is visible text plus a sr-only part, so voice control users can
 * still say what they see ("klik Hapus").
 */
export function PhotoTile({
  tile,
  label,
  onDelete,
  onCancel,
  onRetry,
  onReupload,
}: PhotoTileProps) {
  const { image, upload } = tile;
  const status = photoTileStatus(tile);
  const labelId = useId();
  const named = (text: string) => (
    <>
      {text}
      <span className="sr-only"> {label}</span>
    </>
  );

  const actions = (() => {
    switch (status.kind) {
      case "checking":
      case "queued":
      case "starting":
      case "uploading":
        return upload === undefined ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onCancel(upload.key);
            }}
          >
            {named("Batalkan")}
          </Button>
        );
      case "confirming":
        return null;
      case "rejected":
        return upload === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onCancel(upload.key);
            }}
          >
            {named("Tutup")}
          </Button>
        );
      case "failed":
        return upload === undefined ? null : (
          <>
            {status.retryable && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onRetry(upload.key);
                }}
              >
                {named("Coba lagi")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onCancel(upload.key);
              }}
            >
              {named("Hapus")}
            </Button>
          </>
        );
      case "processing-failed":
        return (
          <>
            {upload !== undefined && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onReupload(upload.key);
                }}
              >
                {named("Unggah ulang")}
              </Button>
            )}
            {image !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onDelete(image, label);
                }}
              >
                {named("Hapus")}
              </Button>
            )}
          </>
        );
      case "processing":
      case "ready":
      case "pending":
        return image === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onDelete(image, label);
            }}
          >
            {named("Hapus")}
          </Button>
        );
    }
  })();

  return (
    <li
      aria-labelledby={labelId}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-lg border border-border p-2"
    >
      <div className="aspect-square overflow-hidden rounded-md bg-muted">
        <TilePicture
          image={image}
          previewUrl={upload?.previewUrl}
          status={status}
        />
      </div>
      <p id={labelId} className="truncate text-sm font-medium" title={label}>
        {label}
      </p>
      <TileStatus status={status} label={label} />
      {actions !== null && (
        <div className="flex flex-wrap gap-1">{actions}</div>
      )}
    </li>
  );
}
