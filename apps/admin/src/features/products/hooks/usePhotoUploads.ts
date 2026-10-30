import { useCallback, useEffect, useReducer, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PRODUCT_IMAGES_MAX,
  confirmProductImage,
  deleteProductImage,
  startProductImageUpload,
} from "@goshop/shared";
import type { AdminProductImage, ImageUploadTicket } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { removeCachedImage, upsertCachedImage } from "../api/image-cache.ts";
import { checkPhotoFile } from "../photo-file-check.ts";
import {
  ACTIVE_PHASES,
  MAX_PARALLEL_UPLOADS,
  newPhotoUpload,
  photoTiles,
  photoUploadsReducer,
  rejectedPhotoUpload,
  settledUploadKeys,
  uploadFailure,
  usedPhotoSlots,
} from "../photo-uploads.ts";
import type { PhotoUpload, UploadStep } from "../photo-uploads.ts";
import { isTicketExpired, uploadToStorage } from "../upload-to-storage.ts";

/** One upload in flight: how to cancel it, and what to clean up after. */
interface Flight {
  controller: AbortController;
  /** The pending photo the API recorded for it, once it did. */
  imageId?: string;
  /**
   * Whether cancelling should delete that photo: yes while the file is
   * not confirmed, no once the confirm was sent (it may be a real photo).
   */
  discardOnCancel: boolean;
}

/** Thrown when the state lost what a step needs: a bug, not a user error. */
const missing = (what: string): never => {
  throw new Error(`photo upload: ${what} is missing`);
};

/**
 * The photo uploads of product `productId`, from the chosen file to a
 * `processing` photo, two at a time:
 *
 * 1. `addFiles`: each file gets a preview (an object URL) and is checked in
 *    the browser (checkPhotoFile). The product's 10-photo limit is applied
 *    here too: files beyond the free slots are refused at once.
 * 2. A checked file waits in the queue; at most MAX_PARALLEL_UPLOADS run.
 * 3. One upload: POST …/images/uploads (a pending photo and a presigned
 *    URL) → PUT the file straight to the storage, with progress (XHR) →
 *    POST …/confirm (the photo is now `processing`). Each answer from the
 *    API goes into the product's cache (image-cache.ts).
 * 4. A failure stops at its step; `retry` continues from that step (a
 *    file whose URL expired gets a new URL, and the old pending photo is
 *    deleted first). `cancel` aborts the request on its way and deletes
 *    the pending photo; leaving the page cancels everything still running.
 *
 * `images` and `dataUpdatedAt` are the product's photos from its query
 * and when they were fetched; the hook merges them with its uploads into
 * the tiles on screen.
 */
export const usePhotoUploads = (
  productId: string,
  images: readonly AdminProductImage[],
  dataUpdatedAt: number,
) => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  const [uploads, dispatch] = useReducer(photoUploadsReducer, []);
  const flights = useRef(new Map<string, Flight>());
  const nextKey = useRef(0);

  /** Deletes a pending photo nobody will finish, as well as it can. */
  const discard = useCallback(
    async (imageId: string) => {
      try {
        await deleteProductImage(authApi, productId, imageId);
      } catch {
        // Already gone (404), or the API is unreachable: the API deletes
        // pending photos older than a day by itself (ADR 0007).
      }
      removeCachedImage(queryClient, productId, imageId);
    },
    [authApi, productId, queryClient],
  );

  const run = useCallback(
    async (upload: PhotoUpload) => {
      const { key, file } = upload;
      if (flights.current.has(key)) return;
      const controller = new AbortController();
      const { signal } = controller;
      const flight: Flight = {
        controller,
        imageId: upload.imageId,
        discardOnCancel: true,
      };
      flights.current.set(key, flight);

      let step: UploadStep = upload.failedStep ?? "start";
      let imageId = upload.imageId;
      let ticket: ImageUploadTicket | undefined = upload.ticket;
      try {
        // A presigned URL works 15 minutes: an old one is not worth a
        // try, so the upload starts over with a new one.
        if (
          step === "upload" &&
          (ticket === undefined || isTicketExpired(ticket))
        ) {
          step = "start";
        }
        // Starting over while the API still holds this upload's pending
        // photo: delete it first, or it would hold one of the 10 slots
        // until the API's daily cleanup.
        if (step === "start" && imageId !== undefined) {
          dispatch({ type: "phase", key, phase: "starting" });
          await discard(imageId);
          flight.imageId = undefined;
          imageId = undefined;
          ticket = undefined;
        }

        if (step === "start") {
          dispatch({ type: "phase", key, phase: "starting" });
          const started = await startProductImageUpload(
            authApi,
            productId,
            {
              content_type: upload.contentType ?? missing("content type"),
              size_bytes: file.size,
            },
            { signal },
          );
          imageId = started.image.id;
          ticket = started.upload;
          flight.imageId = imageId;
          upsertCachedImage(queryClient, productId, started.image);
          dispatch({ type: "started", key, imageId, ticket });
          step = "upload";
        }

        if (step === "upload") {
          dispatch({ type: "phase", key, phase: "uploading" });
          await uploadToStorage(ticket ?? missing("upload URL"), file, {
            signal,
            onProgress: (loaded, total) => {
              dispatch({ type: "progress", key, loaded, total });
            },
          });
          step = "confirm";
        }

        dispatch({ type: "phase", key, phase: "confirming" });
        flight.discardOnCancel = false;
        const confirmed = await confirmProductImage(
          authApi,
          productId,
          imageId ?? missing("image ID"),
          { alt: "" },
          { signal },
        );
        upsertCachedImage(queryClient, productId, confirmed);
        dispatch({ type: "confirmed", key, at: Date.now() });
      } catch (error) {
        // Cancelled: `cancel` already removed it and cleaned up.
        if (signal.aborted) return;
        const failure = uploadFailure(error, step);
        if (failure.forgetImage && imageId !== undefined) {
          removeCachedImage(queryClient, productId, imageId);
        }
        dispatch({ type: "failed", key, failure });
      } finally {
        flights.current.delete(key);
      }
    },
    [authApi, discard, productId, queryClient],
  );

  // The queue: whenever the uploads change, start queued ones while fewer
  // than MAX_PARALLEL_UPLOADS are running. `run` marks each as started at
  // once, so the next render sees it running.
  useEffect(() => {
    const running = uploads.filter((upload) =>
      ACTIVE_PHASES.has(upload.phase),
    ).length;
    const free = Math.max(0, MAX_PARALLEL_UPLOADS - running);
    for (const upload of uploads
      .filter((candidate) => candidate.phase === "queued")
      .slice(0, free)) {
      void run(upload);
    }
  }, [uploads, run]);

  // Leaving the page (or another product) cancels what is still running,
  // and deletes the pending photos that will never be confirmed.
  useEffect(() => {
    const inFlight = flights.current;
    return () => {
      for (const {
        controller,
        imageId,
        discardOnCancel,
      } of inFlight.values()) {
        controller.abort();
        if (discardOnCancel && imageId !== undefined) {
          void deleteProductImage(authApi, productId, imageId).catch(() => {
            // The API's own cleanup deletes it after a day.
          });
        }
      }
      inFlight.clear();
    };
  }, [authApi, productId]);

  // Object URLs keep their file in memory until revoked: revoke each one
  // when its upload is gone or settled (its photo is ready), and all of
  // them when the page goes.
  const settled = settledUploadKeys(images, uploads, dataUpdatedAt);
  const livePreviews = useRef(new Set<string>());
  const settledKey = settled.join(",");
  useEffect(() => {
    const settledKeys = new Set(settledKey === "" ? [] : settledKey.split(","));
    const live = new Set(
      uploads
        .filter(
          (upload) => !settledKeys.has(upload.key) && upload.previewUrl !== "",
        )
        .map((upload) => upload.previewUrl),
    );
    for (const url of livePreviews.current) {
      if (!live.has(url)) URL.revokeObjectURL(url);
    }
    livePreviews.current = live;
  }, [uploads, settledKey]);
  useEffect(() => {
    const previews = livePreviews;
    return () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
      previews.current = new Set();
    };
  }, []);

  // While a file is on its way, closing the tab would lose it: ask first.
  const busy = uploads.some(
    (upload) => upload.phase === "queued" || ACTIVE_PHASES.has(upload.phase),
  );
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [busy]);

  const slotsLeft = Math.max(
    0,
    PRODUCT_IMAGES_MAX - usedPhotoSlots(images, uploads),
  );

  const addFiles = (files: readonly File[]) => {
    // Settled uploads have nothing left to show: forget them now.
    if (settled.length > 0) dispatch({ type: "remove", keys: settled });
    let left = slotsLeft;
    const added = files.map((file) => {
      nextKey.current += 1;
      const key = `unggahan-${nextKey.current}`;
      if (left <= 0) {
        return rejectedPhotoUpload(
          key,
          file,
          "",
          `Produk paling banyak punya ${PRODUCT_IMAGES_MAX} foto. Hapus foto lain dulu.`,
        );
      }
      left -= 1;
      return newPhotoUpload(key, file, URL.createObjectURL(file));
    });
    dispatch({ type: "add", uploads: added });
    for (const upload of added) {
      if (upload.phase !== "checking") continue;
      checkPhotoFile(upload.file, upload.previewUrl).then(
        (result) => {
          dispatch(
            result.ok
              ? {
                  type: "checked",
                  key: upload.key,
                  contentType: result.contentType,
                }
              : { type: "rejected", key: upload.key, message: result.message },
          );
        },
        () => {
          dispatch({
            type: "rejected",
            key: upload.key,
            message: "Berkas ini tidak dapat dibaca.",
          });
        },
      );
    }
  };

  /** Stops an upload on its way (or forgets a failed one) and cleans up. */
  const cancel = (key: string) => {
    const upload = uploads.find((candidate) => candidate.key === key);
    const flight = flights.current.get(key);
    flight?.controller.abort();
    flights.current.delete(key);
    dispatch({ type: "remove", keys: [key] });
    const imageId = flight?.imageId ?? upload?.imageId;
    const confirming = flight !== undefined && !flight.discardOnCancel;
    if (imageId !== undefined && !confirming && upload?.phase !== "confirmed") {
      void discard(imageId);
    }
  };

  /** Tries a failed upload again, from the step that failed. */
  const retry = (key: string) => {
    dispatch({ type: "retry", key });
  };

  /**
   * Uploads the same file again after the worker could not process it:
   * the failed photo is deleted first (it holds a slot), then the upload
   * starts over.
   */
  const reupload = async (key: string) => {
    const upload = uploads.find((candidate) => candidate.key === key);
    if (upload?.imageId !== undefined) await discard(upload.imageId);
    dispatch({ type: "reupload", key });
  };

  return {
    tiles: photoTiles(images, uploads, dataUpdatedAt),
    slotsLeft,
    addFiles,
    cancel,
    retry,
    reupload,
  };
};
