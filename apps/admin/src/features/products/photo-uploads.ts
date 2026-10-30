import { isApiError } from "@goshop/shared";
import type {
  AdminProductImage,
  ImageUploadTicket,
  ProductImageContentType,
} from "@goshop/shared";
import { errorMessage } from "@/lib/error-message.ts";
import { StorageUploadError } from "./upload-to-storage.ts";

/*
 * The photo uploads of one product page, as plain data and pure functions:
 * the state the hook (usePhotoUploads) keeps, the reducer that changes it,
 * and how it merges with the product's photos from the API into the tiles
 * on screen. Nothing here touches the network or the DOM.
 */

/**
 * Where one chosen file is:
 *
 *   checking → queued → starting → uploading → confirming → confirmed
 *      ↓                   ↓           ↓            ↓
 *   rejected            failed ←──────┴────────────┘   (retry: back to queued)
 *
 * - `checking`: the browser is checking it (size, type, pixels);
 * - `rejected`: it broke a rule; it never leaves the browser;
 * - `queued`: waiting for a free upload slot (two at a time);
 * - `starting`: asking the API for a presigned URL;
 * - `uploading`: the file is on its way to the storage;
 * - `confirming`: telling the API the file is there;
 * - `confirmed`: the API has it (`processing`); the local preview stays on
 *   screen until the photo is `ready`, then the upload is forgotten;
 * - `failed`: one of the three steps failed; `failedStep` says which, so a
 *   retry continues from there.
 */
export type UploadPhase =
  | "checking"
  | "rejected"
  | "queued"
  | "starting"
  | "uploading"
  | "confirming"
  | "confirmed"
  | "failed";

/** The three requests of one upload, in order. */
export type UploadStep = "start" | "upload" | "confirm";

/** One file the seller chose, and how far it got. */
export interface PhotoUpload {
  /** Local, stable for React's list: the file has no ID until `start`. */
  key: string;
  file: File;
  /** URL.createObjectURL(file): the preview, revoked when the upload goes. */
  previewUrl: string;
  phase: UploadPhase;
  /** The type its first bytes say it is: what the upload declares. */
  contentType?: ProductImageContentType;
  /** Bytes sent to the storage so far, of `total`. */
  loaded: number;
  total: number;
  /** The pending photo's ID, once the API recorded it. */
  imageId?: string;
  /** The presigned request, valid 15 minutes. */
  ticket?: ImageUploadTicket;
  /** The step that failed: a retry starts there. */
  failedStep?: UploadStep;
  /** Why it was rejected or failed, in Indonesian. */
  message?: string;
  /** Whether "Coba lagi" can help (not for a file the API found broken). */
  retryable: boolean;
  /** When it was confirmed (Date.now()), to tell a stale list from a deletion. */
  confirmedAt?: number;
}

/** Uploads running at once: two keep the line busy without starving it. */
export const MAX_PARALLEL_UPLOADS = 2;

/** The phases that hold a request in flight. */
export const ACTIVE_PHASES: ReadonlySet<UploadPhase> = new Set([
  "starting",
  "uploading",
  "confirming",
]);

/** The phases that still need a photo slot of the product. */
const SLOT_PHASES: ReadonlySet<UploadPhase> = new Set([
  "checking",
  "queued",
  "starting",
  "uploading",
  "confirming",
  "failed",
]);

/** A new upload for `file`, being checked. */
export const newPhotoUpload = (
  key: string,
  file: File,
  previewUrl: string,
): PhotoUpload => ({
  key,
  file,
  previewUrl,
  phase: "checking",
  loaded: 0,
  total: file.size,
  retryable: true,
});

/** A new upload that is refused before it starts (no slot left). */
export const rejectedPhotoUpload = (
  key: string,
  file: File,
  previewUrl: string,
  message: string,
): PhotoUpload => ({
  ...newPhotoUpload(key, file, previewUrl),
  phase: "rejected",
  message,
  retryable: false,
});

export type PhotoUploadAction =
  | { type: "add"; uploads: PhotoUpload[] }
  | { type: "checked"; key: string; contentType: ProductImageContentType }
  | { type: "rejected"; key: string; message: string }
  | {
      type: "phase";
      key: string;
      phase: "starting" | "uploading" | "confirming";
    }
  | { type: "started"; key: string; imageId: string; ticket: ImageUploadTicket }
  | { type: "progress"; key: string; loaded: number; total: number }
  | { type: "confirmed"; key: string; at: number }
  | { type: "failed"; key: string; failure: UploadFailure }
  | { type: "retry"; key: string }
  | { type: "reupload"; key: string }
  | { type: "remove"; keys: readonly string[] };

const update = (
  uploads: PhotoUpload[],
  key: string,
  change: (upload: PhotoUpload) => PhotoUpload,
): PhotoUpload[] =>
  uploads.map((upload) => (upload.key === key ? change(upload) : upload));

/**
 * The uploads after `action`. Pure, as React requires of a reducer: it
 * may run twice in development (StrictMode), so every side effect (the
 * requests, the object URLs) lives in the hook, never here.
 */
export const photoUploadsReducer = (
  uploads: PhotoUpload[],
  action: PhotoUploadAction,
): PhotoUpload[] => {
  switch (action.type) {
    case "add":
      return [...uploads, ...action.uploads];
    case "checked":
      return update(uploads, action.key, (upload) => ({
        ...upload,
        phase: "queued",
        contentType: action.contentType,
      }));
    case "rejected":
      return update(uploads, action.key, (upload) => ({
        ...upload,
        phase: "rejected",
        message: action.message,
        retryable: false,
      }));
    case "phase":
      return update(uploads, action.key, (upload) => ({
        ...upload,
        phase: action.phase,
        ...(action.phase === "uploading" ? { loaded: 0 } : {}),
      }));
    case "started":
      return update(uploads, action.key, (upload) => ({
        ...upload,
        imageId: action.imageId,
        ticket: action.ticket,
      }));
    case "progress":
      return update(uploads, action.key, (upload) => ({
        ...upload,
        loaded: action.loaded,
        total: action.total,
      }));
    case "confirmed":
      return update(uploads, action.key, (upload) => ({
        ...upload,
        phase: "confirmed",
        loaded: upload.total,
        confirmedAt: action.at,
        failedStep: undefined,
        message: undefined,
      }));
    case "failed": {
      const { failure } = action;
      return update(uploads, action.key, (upload) => ({
        ...upload,
        phase: "failed",
        failedStep: failure.step,
        message: failure.message,
        retryable: failure.retryable,
        ...(failure.forgetImage
          ? { imageId: undefined, ticket: undefined }
          : {}),
      }));
    }
    case "retry":
      return update(uploads, action.key, (upload) => ({
        ...upload,
        phase: "queued",
        message: undefined,
      }));
    case "reupload":
      // The API's photo is gone (deleted first): start from nothing.
      return update(uploads, action.key, (upload) => ({
        ...upload,
        phase: "queued",
        imageId: undefined,
        ticket: undefined,
        failedStep: undefined,
        message: undefined,
        loaded: 0,
        confirmedAt: undefined,
        retryable: true,
      }));
    case "remove":
      return uploads.filter((upload) => !action.keys.includes(upload.key));
  }
};

/** What a failed step means for the upload, and what a retry does. */
export interface UploadFailure {
  /** The step a retry starts from. */
  step: UploadStep;
  message: string;
  retryable: boolean;
  /** The API's pending photo is gone (refused at confirm): forget its ID. */
  forgetImage: boolean;
}

/** UPLOAD_INVALID reasons that the same file would fail again. */
const BROKEN_FILE_REASONS: Readonly<Record<string, string>> = {
  not_an_image_of_the_declared_type:
    "Isi berkas ini bukan foto JPEG, PNG, atau WebP, jadi server menolaknya.",
  unreadable_image:
    "Server tidak dapat membaca foto ini. Mungkin berkasnya rusak.",
  too_many_pixels:
    "Foto lebih dari 6000 piksel per sisi atau 24 megapiksel. Perkecil, lalu unggah lagi.",
};

/**
 * Why step `step` failed, in Indonesian, and what a retry should do.
 *
 * The storage's failures (StorageUploadError) and the API's (ApiError)
 * meet here. Most of them are worth a retry: an expired URL gets a new one
 * (`step: "start"`; the hook deletes the old pending photo first), a
 * dropped connection sends the file again with the same URL while it is
 * valid. A file the API decoded and found broken is not: the same bytes
 * would fail again.
 */
export const uploadFailure = (
  error: unknown,
  step: UploadStep,
): UploadFailure => {
  const failure = (
    message: string,
    retryable = true,
    retryFrom: UploadStep = step,
    forgetImage = false,
  ): UploadFailure => ({ step: retryFrom, message, retryable, forgetImage });

  if (error instanceof StorageUploadError) {
    switch (error.kind) {
      case "expired":
        // A new URL means a new pending photo: start over (the hook
        // deletes the old one first).
        return failure(
          "Tautan unggah sudah kedaluwarsa (berlaku 15 menit). Coba lagi untuk meminta tautan baru.",
          true,
          "start",
        );
      case "rejected":
        return failure(
          `Penyimpanan menolak berkas ini (HTTP ${error.status}${error.storageCode === undefined ? "" : `, ${error.storageCode}`}). Coba lagi.`,
        );
      case "unavailable":
        return failure(
          "Penyimpanan foto sedang bermasalah. Coba lagi sebentar lagi.",
        );
      case "network":
      case "aborted":
        return failure(
          "Koneksi ke penyimpanan foto terputus, atau penyimpanan menolak permintaan dari dasbor ini. Periksa koneksi Anda, lalu coba lagi.",
        );
    }
  }
  if (isApiError(error, "UPLOAD_INVALID")) {
    // The API deleted the file and the pending photo: a retry starts over.
    const reason =
      typeof error.details.reason === "string" ? error.details.reason : "";
    const broken = BROKEN_FILE_REASONS[reason];
    if (broken !== undefined) return failure(broken, false, "start", true);
    return failure(
      "Berkas yang sampai di penyimpanan tidak sesuai dengan yang dikirim. Coba lagi.",
      true,
      "start",
      true,
    );
  }
  if (isApiError(error, "UPLOAD_MISSING")) {
    return failure(
      "Berkas belum sampai di penyimpanan. Coba lagi untuk mengirimnya ulang.",
      true,
      "upload",
    );
  }
  if (isApiError(error, "IMAGE_LIMIT_REACHED")) {
    return failure(
      "Produk ini sudah punya 10 foto. Hapus satu, lalu coba lagi.",
    );
  }
  if (isApiError(error, "STORAGE_DISABLED")) {
    return failure("Penyimpanan foto belum diatur di server ini.");
  }
  if (isApiError(error, "VALIDATION_FAILED")) {
    return failure("Server menolak jenis atau ukuran berkas ini.", false);
  }
  if (isApiError(error, "NOT_FOUND")) {
    return failure(
      step === "start"
        ? "Produk ini tidak ditemukan lagi."
        : "Foto ini sudah tidak ada di server. Coba lagi untuk mengunggahnya dari awal.",
      step !== "start",
      "start",
      true,
    );
  }
  if (isApiError(error, "FORBIDDEN")) {
    return failure("Akun Anda tidak boleh mengubah foto produk.", false);
  }
  if (
    isApiError(
      error,
      "NETWORK_ERROR",
      "CLIENT_TIMEOUT",
      "TIMEOUT",
      "RATE_LIMITED",
    )
  ) {
    return failure(errorMessage(error));
  }
  return failure("Foto belum terunggah karena kesalahan di server. Coba lagi.");
};

/**
 * How many of the product's 10 photo slots are taken: every photo the API
 * has (pending ones count, as they do at the API), plus every upload still
 * on its way that the API has not recorded yet.
 */
export const usedPhotoSlots = (
  images: readonly AdminProductImage[],
  uploads: readonly PhotoUpload[],
): number => {
  const ids = new Set(images.map((image) => image.id));
  return (
    images.length +
    uploads.filter(
      (upload) =>
        SLOT_PHASES.has(upload.phase) &&
        (upload.imageId === undefined || !ids.has(upload.imageId)),
    ).length
  );
};

/** One square on screen: a photo of the API, a local upload, or both. */
export interface PhotoTile {
  key: string;
  image?: AdminProductImage;
  upload?: PhotoUpload;
}

/**
 * Whether an upload has nothing left to show: the API's photo is ready
 * (its own thumbnail replaces the preview), or it vanished from a list
 * fetched after the confirm (deleted in another tab).
 */
const isSettled = (
  upload: PhotoUpload,
  byId: ReadonlyMap<string, AdminProductImage>,
  dataUpdatedAt: number,
): boolean => {
  if (upload.phase !== "confirmed" || upload.imageId === undefined) {
    return false;
  }
  const image = byId.get(upload.imageId);
  if (image === undefined) {
    return dataUpdatedAt > (upload.confirmedAt ?? Number.POSITIVE_INFINITY);
  }
  return image.status === "ready";
};

/** The keys of the uploads that can be forgotten (and their previews revoked). */
export const settledUploadKeys = (
  images: readonly AdminProductImage[],
  uploads: readonly PhotoUpload[],
  dataUpdatedAt: number,
): string[] => {
  const byId = new Map(images.map((image) => [image.id, image]));
  return uploads
    .filter((upload) => isSettled(upload, byId, dataUpdatedAt))
    .map((upload) => upload.key);
};

/**
 * The tiles on screen, in order: the API's photos by `position` (each with
 * its local upload, while that upload still has something to say), then
 * the uploads the API does not list (yet), in the order they were chosen.
 *
 * The API's list is the truth for what exists; the local upload is the
 * truth for what is happening right now (the progress, an error). Merging
 * by image ID also survives a refetch that raced an upload's start: the
 * upload stays on screen whether or not the list has it yet.
 */
export const photoTiles = (
  images: readonly AdminProductImage[],
  uploads: readonly PhotoUpload[],
  dataUpdatedAt: number,
): PhotoTile[] => {
  const byId = new Map(images.map((image) => [image.id, image]));
  const live = uploads.filter(
    (upload) => !isSettled(upload, byId, dataUpdatedAt),
  );
  const uploadByImage = new Map(
    live.flatMap((upload) =>
      upload.imageId === undefined ? [] : [[upload.imageId, upload] as const],
    ),
  );
  const fromApi = [...images]
    .sort((a, b) => a.position - b.position)
    .map((image): PhotoTile => {
      const upload = uploadByImage.get(image.id);
      return upload === undefined
        ? { key: image.id, image }
        : { key: image.id, image, upload };
    });
  const localOnly = live
    .filter(
      (upload) => upload.imageId === undefined || !byId.has(upload.imageId),
    )
    .map((upload): PhotoTile => ({ key: upload.key, upload }));
  return [...fromApi, ...localOnly];
};

/** What a tile says about itself. */
export type PhotoTileStatus =
  | { kind: "checking" }
  | { kind: "rejected"; message: string }
  | { kind: "queued" }
  | { kind: "starting" }
  | { kind: "uploading"; percent: number }
  | { kind: "confirming" }
  | { kind: "failed"; message: string; retryable: boolean }
  | { kind: "processing" }
  | { kind: "ready" }
  | { kind: "processing-failed" }
  | { kind: "pending" };

/**
 * The tile's status: the local upload's while it is under way or failed
 * (it knows more), the API's photo's once confirmed.
 */
export const photoTileStatus = ({
  image,
  upload,
}: PhotoTile): PhotoTileStatus => {
  if (upload !== undefined && upload.phase !== "confirmed") {
    switch (upload.phase) {
      case "checking":
      case "queued":
      case "starting":
      case "confirming":
        return { kind: upload.phase };
      case "uploading":
        return {
          kind: "uploading",
          percent:
            upload.total > 0
              ? Math.min(100, Math.floor((upload.loaded / upload.total) * 100))
              : 0,
        };
      case "rejected":
        return { kind: "rejected", message: upload.message ?? "" };
      case "failed":
        return {
          kind: "failed",
          message: upload.message ?? "",
          retryable: upload.retryable,
        };
    }
  }
  if (image === undefined) return { kind: "processing" };
  switch (image.status) {
    case "ready":
      return { kind: "ready" };
    case "processing":
      return { kind: "processing" };
    case "failed":
      return { kind: "processing-failed" };
    case "pending_upload":
      return { kind: "pending" };
  }
};

/**
 * One sentence about what is going on, for the section's live region:
 * "Mengunggah 2 foto. 1 foto sedang diproses." It changes only when a
 * photo moves to another stage, not with every percent, so a screen
 * reader hears the milestones without a stream of numbers.
 */
export const photoActivitySummary = (tiles: readonly PhotoTile[]): string => {
  let uploading = 0;
  let processing = 0;
  let failed = 0;
  for (const tile of tiles) {
    switch (photoTileStatus(tile).kind) {
      case "checking":
      case "queued":
      case "starting":
      case "uploading":
      case "confirming":
        uploading += 1;
        break;
      case "processing":
        processing += 1;
        break;
      case "failed":
      case "processing-failed":
        failed += 1;
        break;
      case "rejected":
      case "ready":
      case "pending":
        break;
    }
  }
  return [
    uploading > 0 ? `Mengunggah ${uploading} foto.` : "",
    processing > 0 ? `${processing} foto sedang diproses.` : "",
    failed > 0 ? `${failed} foto gagal.` : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
};
