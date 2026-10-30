import type {
  AdminProduct,
  AdminProductImage,
  ImageUploadTicket,
} from "@goshop/shared";
import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { installFakeXhr, s3Error } from "@/test/fake-xhr.ts";
import { PRODUCT_ID, adminImage, adminProduct } from "@/test/fixtures.ts";
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
  notAPhoto,
  stubImageDecode,
  stubObjectUrls,
} from "@/test/products-photos.ts";
import { renderRouteHook } from "@/test/render.tsx";
import { productKeys } from "../api/queries.ts";
import { photoTileStatus } from "../photo-uploads.ts";
import { usePhotoUploads } from "./usePhotoUploads.ts";

// The whole upload, as the edit page runs it: MSW answers the API (start,
// confirm, delete), the fake XHR stands in for the PUT to the storage
// (XHR is what reports progress), and the browser's preview URLs and
// image decoding are stubbed.

const ticketFor = (
  n: number,
  expiresAt = "2099-01-01T00:00:00Z",
): ImageUploadTicket => ({
  method: "PUT",
  url: `${STORAGE_URL}/products/${String(n)}`,
  headers: { "Content-Type": "image/jpeg", "Content-Length": "2000" },
  expires_at: expiresAt,
});

/**
 * The API: each start records pending photo n (1, 2, …) with a ticket;
 * each confirm answers it processing. `ticketExpiresAt` makes the tickets
 * already expired.
 */
const api = ({ ticketExpiresAt }: { ticketExpiresAt?: string } = {}) => {
  let started = 0;
  server.use(
    startUploadHandler(() => {
      started += 1;
      return uploadResponse({
        image: adminImage(started, { status: "pending_upload", url: null }),
        upload: ticketFor(started, ticketExpiresAt),
      });
    }),
    confirmImageHandler((request) => {
      const id = new URL(request.url).pathname.split("/").at(-2) ?? "";
      return imageResponse(
        adminImage(Number(id.slice(-12)), { status: "processing" }),
      );
    }),
    deleteImageHandler(),
  );
};

// Unmounting with uploads in flight discards their pending photos
// (DELETE), after the test is over. Each test's view is unmounted here
// and those requests are waited for while this test's handlers still
// answer them: otherwise they land in the next test's request log.
let mounted: { unmount: () => void } | undefined;
let inFlight = 0;
const countRequests = () => {
  // DELETEs only: a request the test aborted (a cancel) never ends.
  server.events.on("request:start", ({ request }) => {
    if (request.method === "DELETE") inFlight += 1;
  });
  server.events.on("request:end", ({ request }) => {
    if (request.method === "DELETE") inFlight -= 1;
  });
};
afterEach(async () => {
  if (mounted !== undefined) {
    const view = mounted;
    mounted = undefined;
    act(() => {
      view.unmount();
    });
  }
  await waitFor(() => {
    expect(inFlight).toBe(0);
  });
});

const setup = ({
  images = [] as AdminProductImage[],
  dataUpdatedAt = 0,
} = {}) => {
  const urls = stubObjectUrls();
  stubImageDecode();
  const xhrs = installFakeXhr();
  const sent = recordRequests();
  inFlight = 0;
  countRequests();
  const queryClient = createQueryClient();
  queryClient.setQueryData(
    productKeys.detail(PRODUCT_ID),
    adminProduct({ images }),
  );
  const view = renderRouteHook(
    (props: { images: AdminProductImage[]; dataUpdatedAt: number }) =>
      usePhotoUploads(PRODUCT_ID, props.images, props.dataUpdatedAt),
    { queryClient, initialProps: { images, dataUpdatedAt } },
  );
  mounted = view;
  const statuses = () =>
    view.result.current.tiles.map((tile) => photoTileStatus(tile).kind);
  /** Method and path of every API request so far. */
  const calls = () =>
    sent.map(
      (r) =>
        `${r.method} ${r.url.pathname.replace(`/v1/admin/products/${PRODUCT_ID}`, "")}`,
    );
  const cachedImages = () =>
    queryClient.getQueryData<AdminProduct>(productKeys.detail(PRODUCT_ID))
      ?.images ?? [];
  const add = (...files: File[]) => {
    act(() => {
      view.result.current.addFiles(files);
    });
  };
  const xhrCount = () => xhrs.instances.length;
  return {
    ...view,
    urls,
    xhrs,
    sent,
    queryClient,
    statuses,
    calls,
    cachedImages,
    add,
    xhrCount,
  };
};

const id = (n: number) => adminImage(n).id;

describe("usePhotoUploads", () => {
  it("checks, starts, uploads with progress, confirms, and caches each step's photo", async () => {
    api();
    const { add, xhrs, statuses, calls, sent, cachedImages, result, urls } =
      setup();

    add(jpegFile("kaos.jpg", 2_000));
    expect(result.current.tiles[0]?.upload?.previewUrl).toBe(urls.created[0]);
    await waitFor(() => {
      expect(xhrs.instances).toHaveLength(1);
    });

    expect(await sent[0]?.json()).toEqual({
      content_type: "image/jpeg",
      size_bytes: 2_000,
    });
    expect(cachedImages().map((i) => i.status)).toEqual(["pending_upload"]);
    const xhr = xhrs.last();
    expect(xhr.url).toBe(`${STORAGE_URL}/products/1`);
    act(() => {
      xhr.progress(500, 2_000);
    });
    expect(photoTileStatus(result.current.tiles[0] ?? { key: "" })).toEqual({
      kind: "uploading",
      percent: 25,
    });
    act(() => {
      xhr.respond(200);
    });

    await waitFor(() => {
      expect(cachedImages().map((i) => i.status)).toEqual(["processing"]);
    });
    expect(calls()).toEqual([
      "POST /images/uploads",
      `POST /images/${id(1)}/confirm`,
    ]);
    expect(await sent[1]?.json()).toEqual({ alt: "" });
    expect(statuses()).toEqual(["processing"]);
    expect(result.current.tiles[0]?.upload?.phase).toBe("confirmed");
  });

  it("refuses files past the 10th photo, and counts what is left", async () => {
    api();
    const nine = Array.from({ length: 9 }, (_, i) => adminImage(i + 1));
    const { add, result, calls } = setup({ images: nine });
    expect(result.current.slotsLeft).toBe(1);

    add(notAPhoto("a.heic"), jpegFile("b.jpg"));

    const [, second] = result.current.tiles.slice(9);
    expect(photoTileStatus(second ?? { key: "" })).toEqual({
      kind: "rejected",
      message: "Produk paling banyak punya 10 foto. Hapus foto lain dulu.",
    });
    expect(second?.upload?.previewUrl).toBe("");
    expect(result.current.slotsLeft).toBe(0);
    await waitFor(() => {
      expect(photoTileStatus(result.current.tiles[9] ?? { key: "" }).kind).toBe(
        "rejected",
      );
    });
    expect(calls()).toEqual([]);
  });

  it("rejects a file that is not a photo without a request, freeing its slot", async () => {
    api();
    const { add, statuses, calls, result } = setup();

    add(notAPhoto());

    await waitFor(() => {
      expect(statuses()).toEqual(["rejected"]);
    });
    expect(calls()).toEqual([]);
    expect(result.current.slotsLeft).toBe(10);
  });

  it("rejects a file that cannot be read at all", async () => {
    api();
    const { add, result } = setup();
    const broken = jpegFile();
    Object.defineProperty(broken, "slice", {
      value: () => {
        throw new Error("NotReadableError");
      },
    });

    add(broken);

    await waitFor(() => {
      expect(photoTileStatus(result.current.tiles[0] ?? { key: "" })).toEqual({
        kind: "rejected",
        message: "Berkas ini tidak dapat dibaca.",
      });
    });
  });

  it("uploads two at a time, and starts the third when one is done", async () => {
    api();
    const { add, xhrs, xhrCount, statuses } = setup();

    add(jpegFile("1.jpg"), jpegFile("2.jpg"), jpegFile("3.jpg"));
    // The XHR is made in the same tick the "uploading" phase is dispatched,
    // before React renders it: wait for both.
    await waitFor(() => {
      expect(xhrCount()).toBe(2);
      expect(statuses()).toEqual(["uploading", "uploading", "queued"]);
    });

    act(() => {
      xhrs.instances[0]?.respond(200);
    });

    await waitFor(() => {
      expect(xhrCount()).toBe(3);
    });
  });

  it("retries a failed upload from the step that failed, with the same ticket", async () => {
    api();
    const { add, xhrs, xhrCount, statuses, calls, result } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });

    act(() => {
      xhrs.last().respond(503, s3Error("SlowDown", "Reduce your request rate"));
    });
    await waitFor(() => {
      expect(statuses()).toEqual(["failed"]);
    });
    const key = result.current.tiles[0]?.upload?.key ?? "";

    act(() => {
      result.current.retry(key);
    });
    await waitFor(() => {
      expect(xhrCount()).toBe(2);
    });
    expect(xhrs.last().url).toBe(`${STORAGE_URL}/products/1`);
    act(() => {
      xhrs.last().respond(200);
    });

    await waitFor(() => {
      expect(result.current.tiles[0]?.upload?.phase).toBe("confirmed");
    });
    expect(calls()).toEqual([
      "POST /images/uploads",
      `POST /images/${id(1)}/confirm`,
    ]);
  });

  it("asks for a new ticket on retry when the old one expired, discarding the old photo", async () => {
    api({ ticketExpiresAt: "2000-01-01T00:00:00Z" });
    const { add, xhrs, xhrCount, calls, result } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });
    act(() => {
      xhrs.last().respond(403, s3Error("AccessDenied", "Request has expired"));
    });
    await waitFor(() => {
      expect(result.current.tiles.at(-1)?.upload?.failedStep).toBe("start");
    });

    act(() => {
      result.current.retry(result.current.tiles.at(-1)?.upload?.key ?? "");
    });

    await waitFor(() => {
      expect(xhrCount()).toBe(2);
    });
    expect(calls()).toEqual([
      "POST /images/uploads",
      `DELETE /images/${id(1)}`,
      "POST /images/uploads",
    ]);
    expect(xhrs.last().url).toBe(`${STORAGE_URL}/products/2`);
  });

  it("asks for a new ticket on retry when the clock says the old one ran out", async () => {
    api({ ticketExpiresAt: "2000-01-01T00:00:00Z" });
    const { add, xhrs, xhrCount, calls, result } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });
    act(() => {
      xhrs.last().respond(500);
    });
    await waitFor(() => {
      expect(result.current.tiles.at(-1)?.upload?.failedStep).toBe("upload");
    });

    act(() => {
      result.current.retry(result.current.tiles.at(-1)?.upload?.key ?? "");
    });

    await waitFor(() => {
      expect(calls()).toEqual([
        "POST /images/uploads",
        `DELETE /images/${id(1)}`,
        "POST /images/uploads",
      ]);
    });
  });

  it("forgets a photo the API refused at confirm, and does not offer a retry", async () => {
    api();
    server.use(
      confirmImageHandler(() =>
        errorResponse(422, "UPLOAD_INVALID", {
          details: { reason: "too_many_pixels" },
        }),
      ),
    );
    const { add, xhrs, xhrCount, cachedImages, result } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });

    act(() => {
      xhrs.last().respond(200);
    });

    await waitFor(() => {
      expect(
        photoTileStatus(result.current.tiles[0] ?? { key: "" }),
      ).toMatchObject({
        kind: "failed",
        retryable: false,
      });
    });
    expect(cachedImages()).toEqual([]);
    expect(result.current.tiles[0]?.upload?.imageId).toBeUndefined();
  });

  it("cancels an upload: aborts the PUT, deletes the pending photo, drops the tile", async () => {
    api();
    const { add, xhrs, xhrCount, calls, result, cachedImages } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });

    act(() => {
      result.current.cancel(result.current.tiles.at(-1)?.upload?.key ?? "");
    });

    expect(xhrs.last().aborted).toBe(true);
    await waitFor(() => {
      expect(calls()).toEqual([
        "POST /images/uploads",
        `DELETE /images/${id(1)}`,
      ]);
    });
    expect(result.current.tiles).toEqual([]);
    await waitFor(() => {
      expect(cachedImages()).toEqual([]);
    });
  });

  it("cancels a queued upload without a request", async () => {
    api();
    const { add, xhrCount, calls, result } = setup();
    add(jpegFile("1.jpg"), jpegFile("2.jpg"), jpegFile("3.jpg"));
    await waitFor(() => {
      expect(xhrCount()).toBe(2);
    });
    const queued = result.current.tiles.find(
      (tile) => tile.upload?.phase === "queued",
    );

    act(() => {
      result.current.cancel(queued?.upload?.key ?? "");
    });

    expect(result.current.tiles).toHaveLength(2);
    expect(calls().filter((call) => call.startsWith("DELETE"))).toEqual([]);
  });

  it("keeps the photo of an upload cancelled while it is being confirmed", async () => {
    api();
    let answerConfirm: (() => void) | undefined;
    server.use(
      confirmImageHandler(
        () =>
          new Promise<Response>((resolve) => {
            answerConfirm = () => {
              resolve(imageResponse(adminImage(1, { status: "processing" })));
            };
          }),
      ),
    );
    const { add, xhrs, xhrCount, calls, result } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });
    act(() => {
      xhrs.last().respond(200);
    });
    await waitFor(() => {
      expect(result.current.tiles.at(-1)?.upload?.phase).toBe("confirming");
    });

    act(() => {
      result.current.cancel(result.current.tiles.at(-1)?.upload?.key ?? "");
    });
    answerConfirm?.();
    // A DELETE, had the cancel sent one, would go out before the start of
    // a photo picked after it: wait for that start, then look.
    add(jpegFile("2.jpg"));
    await waitFor(() => {
      expect(
        calls().filter((call) => call === "POST /images/uploads"),
      ).toHaveLength(2);
    });

    expect(calls().filter((call) => call.startsWith("DELETE"))).toEqual([]);
  });

  it("re-uploads a photo the server could not process: discards it, then starts again", async () => {
    api();
    const failed = adminImage(5, { status: "failed" });
    const { add, xhrs, xhrCount, calls, result, rerender } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });
    act(() => {
      xhrs.last().respond(200);
    });
    await waitFor(() => {
      expect(result.current.tiles.at(-1)?.upload?.phase).toBe("confirmed");
    });
    const upload = result.current.tiles.at(-1)?.upload;
    rerender({
      images: [{ ...failed, id: upload?.imageId ?? "" }],
      dataUpdatedAt: 1,
    });

    await act(() => result.current.reupload(upload?.key ?? ""));

    await waitFor(() => {
      expect(xhrCount()).toBe(2);
    });
    expect(calls().slice(2)).toEqual([
      `DELETE /images/${id(1)}`,
      "POST /images/uploads",
    ]);
  });

  it("drops a finished upload once its photo is ready, revoking its preview", async () => {
    api();
    const { add, xhrs, xhrCount, result, rerender, urls } = setup();
    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });
    act(() => {
      xhrs.last().respond(200);
    });
    await waitFor(() => {
      expect(result.current.tiles.at(-1)?.upload?.phase).toBe("confirmed");
    });

    rerender({ images: [adminImage(1)], dataUpdatedAt: Date.now() });

    expect(result.current.tiles).toEqual([
      { key: id(1), image: adminImage(1) },
    ]);
    await waitFor(() => {
      expect(urls.revoked).toEqual(urls.created);
    });
    // The next pick removes the settled upload from the list for good.
    add(notAPhoto());
    expect(result.current.tiles.map((tile) => tile.upload?.file.name)).toEqual([
      undefined,
      "foto.heic",
    ]);
  });

  it("aborts and discards what is in flight, and revokes every preview, when unmounted", async () => {
    api();
    const { add, xhrs, xhrCount, calls, unmount, urls } = setup();
    add(jpegFile("1.jpg"), notAPhoto());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });

    unmount();

    expect(xhrs.last().aborted).toBe(true);
    await waitFor(() => {
      expect(calls()).toContain(`DELETE /images/${id(1)}`);
    });
    expect(urls.revoked).toEqual(expect.arrayContaining(urls.created));
  });

  it("asks before the page is left while uploads run, and not after", async () => {
    api();
    const { add, xhrs, xhrCount, result } = setup();
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    add(jpegFile());
    await waitFor(() => {
      expect(xhrCount()).toBe(1);
    });
    expect(leave()).toBe(true);
    act(() => {
      xhrs.last().respond(200);
    });
    await waitFor(() => {
      expect(result.current.tiles.at(-1)?.upload?.phase).toBe("confirmed");
    });

    expect(leave()).toBe(false);
  });
});
