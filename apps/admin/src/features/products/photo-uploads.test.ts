import { ApiError } from "@goshop/shared";
import type { ImageUploadTicket } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { adminImage } from "@/test/fixtures.ts";
import { jpegFile } from "@/test/products-photos.ts";
import {
  ACTIVE_PHASES,
  MAX_PARALLEL_UPLOADS,
  newPhotoUpload,
  photoActivitySummary,
  photoTileStatus,
  photoTiles,
  photoUploadsReducer,
  rejectedPhotoUpload,
  settledUploadKeys,
  uploadFailure,
  usedPhotoSlots,
} from "./photo-uploads.ts";
import type { PhotoUpload, UploadStep } from "./photo-uploads.ts";
import { StorageUploadError } from "./upload-to-storage.ts";

const ticket: ImageUploadTicket = {
  method: "PUT",
  url: "http://storage.test/x",
  headers: {},
  expires_at: "2026-10-30T03:15:00Z",
};

/** An upload in `phase`, 2000 bytes, unless told otherwise. */
const upload = (
  key: string,
  overrides: Partial<PhotoUpload> = {},
): PhotoUpload => ({
  ...newPhotoUpload(key, jpegFile(`${key}.jpg`), `blob:${key}`),
  ...overrides,
});

const apiError = (code: string, details?: Record<string, unknown>) =>
  new ApiError({ status: 400, code, message: "x", details });

describe("the upload limits", () => {
  it("runs two uploads at once; starting, uploading and confirming are active", () => {
    expect(MAX_PARALLEL_UPLOADS).toBe(2);
    expect([...ACTIVE_PHASES]).toEqual(["starting", "uploading", "confirming"]);
  });
});

describe("newPhotoUpload and rejectedPhotoUpload", () => {
  it("starts in checking, nothing sent of the file's size, retryable", () => {
    const file = jpegFile("a.jpg", 1_234);

    expect(newPhotoUpload("k1", file, "blob:1")).toEqual({
      key: "k1",
      file,
      previewUrl: "blob:1",
      phase: "checking",
      loaded: 0,
      total: 1_234,
      retryable: true,
    });
  });

  it("is rejected with its message, never retryable", () => {
    const rejected = rejectedPhotoUpload(
      "k2",
      jpegFile(),
      "",
      "Terlalu banyak.",
    );

    expect(rejected).toMatchObject({
      phase: "rejected",
      message: "Terlalu banyak.",
      retryable: false,
      previewUrl: "",
    });
  });
});

describe("photoUploadsReducer", () => {
  const two = [upload("a"), upload("b")];

  it("adds uploads at the end", () => {
    expect(
      photoUploadsReducer([upload("a")], {
        type: "add",
        uploads: [upload("b")],
      }).map((u) => u.key),
    ).toEqual(["a", "b"]);
  });

  it("queues a checked upload with its type, leaving the others", () => {
    const [a, b] = photoUploadsReducer(two, {
      type: "checked",
      key: "a",
      contentType: "image/png",
    });

    expect(a).toMatchObject({ phase: "queued", contentType: "image/png" });
    expect(b).toBe(two[1]);
  });

  it("rejects an upload with its message, not retryable", () => {
    const [a] = photoUploadsReducer(two, {
      type: "rejected",
      key: "a",
      message: "Bukan foto.",
    });

    expect(a).toMatchObject({
      phase: "rejected",
      message: "Bukan foto.",
      retryable: false,
    });
  });

  it("resets the bytes sent when uploading starts, and only then", () => {
    const sent = [upload("a", { loaded: 900 })];

    expect(
      photoUploadsReducer(sent, {
        type: "phase",
        key: "a",
        phase: "uploading",
      })[0],
    ).toMatchObject({ phase: "uploading", loaded: 0 });
    expect(
      photoUploadsReducer(sent, {
        type: "phase",
        key: "a",
        phase: "confirming",
      })[0],
    ).toMatchObject({ phase: "confirming", loaded: 900 });
  });

  it("keeps the image ID and ticket once started", () => {
    const [a] = photoUploadsReducer(two, {
      type: "started",
      key: "a",
      imageId: "img-1",
      ticket,
    });

    expect(a).toMatchObject({ imageId: "img-1", ticket });
  });

  it("records progress", () => {
    const [a] = photoUploadsReducer(two, {
      type: "progress",
      key: "a",
      loaded: 10,
      total: 40,
    });

    expect(a).toMatchObject({ loaded: 10, total: 40 });
  });

  it("marks a confirmed upload complete and forgets its failure", () => {
    const failed = [
      upload("a", { failedStep: "confirm", message: "x", loaded: 3 }),
    ];

    expect(
      photoUploadsReducer(failed, { type: "confirmed", key: "a", at: 42 })[0],
    ).toMatchObject({
      phase: "confirmed",
      loaded: 2_000,
      confirmedAt: 42,
      failedStep: undefined,
      message: undefined,
    });
  });

  it("records a failure; one that forgets the image drops its ID and ticket", () => {
    const started = [upload("a", { imageId: "img-1", ticket })];
    const failure = (forgetImage: boolean) => ({
      step: "start" as const,
      message: "Gagal.",
      retryable: false,
      forgetImage,
    });

    expect(
      photoUploadsReducer(started, {
        type: "failed",
        key: "a",
        failure: failure(false),
      })[0],
    ).toMatchObject({
      phase: "failed",
      failedStep: "start",
      message: "Gagal.",
      retryable: false,
      imageId: "img-1",
      ticket,
    });
    const forgotten = photoUploadsReducer(started, {
      type: "failed",
      key: "a",
      failure: failure(true),
    })[0];
    expect(forgotten?.imageId).toBeUndefined();
    expect(forgotten?.ticket).toBeUndefined();
  });

  it("queues a retry, keeping where it failed", () => {
    const failed = [
      upload("a", { phase: "failed", failedStep: "upload", message: "x" }),
    ];

    expect(
      photoUploadsReducer(failed, { type: "retry", key: "a" })[0],
    ).toMatchObject({
      phase: "queued",
      failedStep: "upload",
      message: undefined,
    });
  });

  it("starts a re-upload from scratch", () => {
    const done = [
      upload("a", {
        phase: "confirmed",
        imageId: "img-1",
        ticket,
        failedStep: "confirm",
        message: "x",
        loaded: 2_000,
        confirmedAt: 5,
        retryable: false,
      }),
    ];

    expect(
      photoUploadsReducer(done, { type: "reupload", key: "a" })[0],
    ).toMatchObject({
      phase: "queued",
      imageId: undefined,
      ticket: undefined,
      failedStep: undefined,
      message: undefined,
      loaded: 0,
      confirmedAt: undefined,
      retryable: true,
    });
  });

  it("removes the uploads named", () => {
    expect(
      photoUploadsReducer([...two, upload("c")], {
        type: "remove",
        keys: ["a", "c"],
      }).map((u) => u.key),
    ).toEqual(["b"]);
  });
});

describe("uploadFailure", () => {
  const failureOf = (error: unknown, step: UploadStep = "upload") =>
    uploadFailure(error, step);

  it("restarts an expired URL from the start", () => {
    expect(failureOf(new StorageUploadError("expired", 403))).toEqual({
      step: "start",
      message:
        "Tautan unggah sudah kedaluwarsa (berlaku 15 menit). Coba lagi untuk meminta tautan baru.",
      retryable: true,
      forgetImage: false,
    });
  });

  it("names the storage's status and code for a refusal, and restarts it with a new URL", () => {
    // The same signed request would be refused the same way.
    expect(
      failureOf(new StorageUploadError("rejected", 403, "AccessDenied")),
    ).toEqual({
      step: "start",
      message:
        "Penyimpanan menolak berkas ini (HTTP 403, AccessDenied). Coba lagi untuk meminta tautan baru.",
      retryable: true,
      forgetImage: false,
    });
    expect(failureOf(new StorageUploadError("rejected", 400))).toMatchObject({
      step: "start",
      message:
        "Penyimpanan menolak berkas ini (HTTP 400). Coba lagi untuk meminta tautan baru.",
      retryable: true,
    });
  });

  it.each([
    ["a 5xx", new StorageUploadError("unavailable", 503)],
    ["a dropped connection", new StorageUploadError("network")],
  ])("sends the file again with the same URL after %s", (_name, error) => {
    expect(failureOf(error)).toMatchObject({
      step: "upload",
      retryable: true,
      forgetImage: false,
    });
  });

  it("says the storage is in trouble for a 5xx", () => {
    expect(failureOf(new StorageUploadError("unavailable", 503))).toMatchObject(
      {
        step: "upload",
        message: "Penyimpanan foto sedang bermasalah. Coba lagi sebentar lagi.",
      },
    );
  });

  it.each(["network", "aborted"] as const)(
    "blames the connection for %s",
    (kind) => {
      expect(failureOf(new StorageUploadError(kind)).message).toBe(
        "Koneksi ke penyimpanan foto terputus, atau penyimpanan menolak permintaan dari dasbor ini. Periksa koneksi Anda, lalu coba lagi.",
      );
    },
  );

  it.each([
    [
      "not_an_image_of_the_declared_type",
      "Isi berkas ini bukan foto JPEG, PNG, atau WebP, jadi server menolaknya.",
    ],
    [
      "unreadable_image",
      "Server tidak dapat membaca foto ini. Mungkin berkasnya rusak.",
    ],
    [
      "too_many_pixels",
      "Foto lebih dari 6000 piksel per sisi atau 24 megapiksel. Perkecil, lalu unggah lagi.",
    ],
  ])(
    "calls a file the API found broken (%s) final, forgetting the image",
    (reason, message) => {
      expect(
        failureOf(apiError("UPLOAD_INVALID", { reason }), "confirm"),
      ).toEqual({
        step: "start",
        message,
        retryable: false,
        forgetImage: true,
      });
    },
  );

  it.each([
    ["another reason", { reason: "size_mismatch" }],
    ["no reason", undefined],
    ["a reason that is not text", { reason: 3 }],
  ])("retries an UPLOAD_INVALID with %s from the start", (_name, details) => {
    expect(failureOf(apiError("UPLOAD_INVALID", details), "confirm")).toEqual({
      step: "start",
      message:
        "Berkas yang sampai di penyimpanan tidak sesuai dengan yang dikirim. Coba lagi.",
      retryable: true,
      forgetImage: true,
    });
  });

  it("sends the file again when it never arrived", () => {
    expect(failureOf(apiError("UPLOAD_MISSING"), "confirm")).toEqual({
      step: "upload",
      message:
        "Berkas belum sampai di penyimpanan. Coba lagi untuk mengirimnya ulang.",
      retryable: true,
      forgetImage: false,
    });
  });

  it.each([
    [
      "IMAGE_LIMIT_REACHED",
      "Produk ini sudah punya 10 foto. Hapus satu, lalu coba lagi.",
      true,
    ],
    ["STORAGE_DISABLED", "Penyimpanan foto belum diatur di server ini.", true],
    [
      "VALIDATION_FAILED",
      "Server menolak jenis atau ukuran berkas ini.",
      false,
    ],
    ["FORBIDDEN", "Akun Anda tidak boleh mengubah foto produk.", false],
  ])("explains %s, retryable: %s", (code, message, retryable) => {
    expect(failureOf(apiError(code), "start")).toEqual({
      step: "start",
      message,
      retryable,
      forgetImage: false,
    });
  });

  it("calls a missing product final when starting", () => {
    expect(failureOf(apiError("NOT_FOUND"), "start")).toEqual({
      step: "start",
      message: "Produk ini tidak ditemukan lagi.",
      retryable: false,
      forgetImage: true,
    });
  });

  it("starts over when the pending photo is gone at confirm", () => {
    expect(failureOf(apiError("NOT_FOUND"), "confirm")).toEqual({
      step: "start",
      message:
        "Foto ini sudah tidak ada di server. Coba lagi untuk mengunggahnya dari awal.",
      retryable: true,
      forgetImage: true,
    });
  });

  it.each([
    ["NETWORK_ERROR", "Tidak dapat terhubung ke server GoShop."],
    ["CLIENT_TIMEOUT", "Server GoShop terlalu lama merespons."],
    ["RATE_LIMITED", "Terlalu banyak permintaan."],
  ])("uses the general sentence for %s, from the same step", (code, start) => {
    const failure = failureOf(apiError(code), "confirm");

    expect(failure.message.startsWith(start)).toBe(true);
    expect(failure).toMatchObject({ step: "confirm", retryable: true });
  });

  it("says the photo is not up for anything else", () => {
    expect(failureOf(new Error("boom"), "confirm")).toEqual({
      step: "confirm",
      message: "Foto belum terunggah karena kesalahan di server. Coba lagi.",
      retryable: true,
      forgetImage: false,
    });
  });
});

describe("usedPhotoSlots", () => {
  const images = [adminImage(1), adminImage(2)];

  it("counts the photos and every upload holding a slot", () => {
    expect(
      usedPhotoSlots(images, [
        upload("checking"),
        upload("queued", { phase: "queued" }),
        upload("starting", { phase: "starting" }),
        upload("uploading", { phase: "uploading" }),
        upload("confirming", { phase: "confirming" }),
        upload("failed", { phase: "failed" }),
      ]),
    ).toBe(8);
  });

  it("frees the slot of a rejected or confirmed upload", () => {
    expect(
      usedPhotoSlots(images, [
        upload("r", { phase: "rejected" }),
        upload("c", { phase: "confirmed", imageId: "img-new" }),
      ]),
    ).toBe(2);
  });

  it("does not count twice an upload whose photo is already listed", () => {
    expect(
      usedPhotoSlots(images, [
        upload("u", { phase: "uploading", imageId: images[0]?.id }),
      ]),
    ).toBe(2);
  });
});

describe("settledUploadKeys and photoTiles", () => {
  const ready = adminImage(1);
  const processing = adminImage(2, { status: "processing" });

  it("settles a confirmed upload once its photo is ready, and keeps one still processing", () => {
    const uploads = [
      upload("a", { phase: "confirmed", imageId: ready.id, confirmedAt: 10 }),
      upload("b", {
        phase: "confirmed",
        imageId: processing.id,
        confirmedAt: 10,
      }),
      upload("c", { phase: "uploading", imageId: "img-x" }),
    ];

    expect(settledUploadKeys([ready, processing], uploads, 5)).toEqual(["a"]);
  });

  it("settles a confirmed upload missing from a list fetched after it (deleted since)", () => {
    const confirmed = [
      upload("a", { phase: "confirmed", imageId: "img-gone", confirmedAt: 10 }),
    ];

    expect(settledUploadKeys([], confirmed, 9)).toEqual([]);
    expect(settledUploadKeys([], confirmed, 10)).toEqual([]);
    expect(settledUploadKeys([], confirmed, 11)).toEqual(["a"]);
  });

  it("never settles a confirmed upload without its confirm time or image", () => {
    expect(
      settledUploadKeys(
        [],
        [
          upload("a", { phase: "confirmed", imageId: "img-1" }),
          upload("b", { phase: "confirmed" }),
        ],
        Number.MAX_SAFE_INTEGER,
      ),
    ).toEqual([]);
  });

  it("lists the API's photos by position, each with its upload, then the uploads without a photo", () => {
    const first = adminImage(1, { position: 2 });
    const second = adminImage(2, { position: 1 });
    const tied = upload("t", { phase: "confirming", imageId: first.id });
    const local = upload("l", { phase: "queued" });

    expect(photoTiles([first, second], [tied, local], 0)).toEqual([
      { key: second.id, image: second },
      { key: first.id, image: first, upload: tied },
      { key: "l", upload: local },
    ]);
  });

  it("drops a settled upload, keeping its photo's tile", () => {
    const done = upload("d", {
      phase: "confirmed",
      imageId: ready.id,
      confirmedAt: 1,
    });

    expect(photoTiles([ready], [done], 0)).toEqual([
      { key: ready.id, image: ready },
    ]);
  });

  it("keeps an upload whose photo the list does not have yet as its own tile", () => {
    const started = upload("s", {
      phase: "uploading",
      imageId: "img-not-listed",
    });

    expect(photoTiles([], [started], 0)).toEqual([
      { key: "s", upload: started },
    ]);
  });
});

describe("photoTileStatus", () => {
  it.each(["checking", "queued", "starting", "confirming"] as const)(
    "is %s for an upload in that phase",
    (phase) => {
      expect(
        photoTileStatus({ key: "k", upload: upload("k", { phase }) }),
      ).toEqual({ kind: phase });
    },
  );

  it("is the percentage sent, rounded down, at most 100", () => {
    const at = (loaded: number, total: number) =>
      photoTileStatus({
        key: "k",
        upload: upload("k", { phase: "uploading", loaded, total }),
      });

    expect(at(999, 1_000)).toEqual({ kind: "uploading", percent: 99 });
    expect(at(2_000, 1_000)).toEqual({ kind: "uploading", percent: 100 });
    expect(at(5, 0)).toEqual({ kind: "uploading", percent: 0 });
  });

  it("carries a rejection's and a failure's message", () => {
    expect(
      photoTileStatus({
        key: "k",
        upload: upload("k", { phase: "rejected", message: "Bukan foto." }),
      }),
    ).toEqual({ kind: "rejected", message: "Bukan foto." });
    expect(
      photoTileStatus({
        key: "k",
        upload: upload("k", {
          phase: "failed",
          message: "Gagal.",
          retryable: false,
        }),
      }),
    ).toEqual({ kind: "failed", message: "Gagal.", retryable: false });
    expect(
      photoTileStatus({ key: "k", upload: upload("k", { phase: "failed" }) }),
    ).toEqual({ kind: "failed", message: "", retryable: true });
    expect(
      photoTileStatus({ key: "k", upload: upload("k", { phase: "rejected" }) }),
    ).toEqual({
      kind: "rejected",
      message: "",
    });
  });

  it.each([
    ["ready", "ready"],
    ["processing", "processing"],
    ["failed", "processing-failed"],
    ["pending_upload", "pending"],
  ] as const)("follows the photo once confirmed: %s is %s", (status, kind) => {
    const image = adminImage(1, { status });

    expect(photoTileStatus({ key: "k", image })).toEqual({ kind });
    expect(
      photoTileStatus({
        key: "k",
        image,
        upload: upload("k", { phase: "confirmed" }),
      }),
    ).toEqual({ kind });
  });

  it("is processing for a confirmed upload whose photo is not listed yet", () => {
    expect(
      photoTileStatus({
        key: "k",
        upload: upload("k", { phase: "confirmed" }),
      }),
    ).toEqual({
      kind: "processing",
    });
  });
});

describe("photoActivitySummary", () => {
  it("counts what is uploading, processing and failed, in that order", () => {
    expect(
      photoActivitySummary([
        { key: "1", upload: upload("1", { phase: "queued" }) },
        { key: "2", upload: upload("2", { phase: "uploading" }) },
        { key: "3", upload: upload("3") },
        { key: "4", upload: upload("4", { phase: "starting" }) },
        { key: "5", upload: upload("5", { phase: "confirming" }) },
        { key: "6", image: adminImage(6, { status: "processing" }) },
        { key: "7", upload: upload("7", { phase: "failed" }) },
        { key: "8", image: adminImage(8, { status: "failed" }) },
        { key: "9", image: adminImage(9) },
        { key: "10", upload: upload("10", { phase: "rejected" }) },
        { key: "11", image: adminImage(11, { status: "pending_upload" }) },
      ]),
    ).toBe("Mengunggah 5 foto. 1 foto sedang diproses. 2 foto gagal.");
  });

  it("is empty when nothing is going on", () => {
    expect(photoActivitySummary([{ key: "1", image: adminImage(1) }])).toBe("");
    expect(photoActivitySummary([])).toBe("");
  });

  it("names only what there is", () => {
    expect(
      photoActivitySummary([
        { key: "6", image: adminImage(6, { status: "processing" }) },
      ]),
    ).toBe("1 foto sedang diproses.");
  });
});
