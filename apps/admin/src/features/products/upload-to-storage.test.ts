import type { ImageUploadTicket } from "@goshop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeXhr, s3Error } from "@/test/fake-xhr.ts";
import {
  StorageUploadError,
  isTicketExpired,
  uploadToStorage,
} from "./upload-to-storage.ts";

const NOW = Date.parse("2026-10-30T03:00:00Z");

const ticket = (
  overrides: Partial<ImageUploadTicket> = {},
): ImageUploadTicket => ({
  method: "PUT",
  url: "http://storage.test/products/p1/img-1",
  headers: {
    "Content-Type": "image/jpeg",
    "Content-Length": "4",
    Host: "storage.test",
    "x-amz-meta-image": "img-1",
  },
  expires_at: "2026-10-30T03:15:00Z",
  ...overrides,
});

const file = () =>
  new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" });

/** The error the upload rejected with. */
const failure = async (upload: Promise<void>) => {
  const error = await upload.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(StorageUploadError);
  return error as StorageUploadError;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("isTicketExpired", () => {
  it("is fresh with more than 30 seconds left", () => {
    expect(
      isTicketExpired({ expires_at: "2026-10-30T03:00:30.001Z" }, NOW),
    ).toBe(false);
  });

  it("counts the last 30 seconds as expired", () => {
    expect(
      isTicketExpired({ expires_at: "2026-10-30T03:00:29.999Z" }, NOW),
    ).toBe(true);
  });

  it("takes another margin when given one", () => {
    expect(
      isTicketExpired({ expires_at: "2026-10-30T03:00:01Z" }, NOW, 0),
    ).toBe(false);
    expect(
      isTicketExpired({ expires_at: "2026-10-30T02:59:59Z" }, NOW, 0),
    ).toBe(true);
  });

  it("calls an unreadable time expired", () => {
    expect(isTicketExpired({ expires_at: "nanti" }, NOW)).toBe(true);
  });

  it("asks the real clock by default", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });

    expect(isTicketExpired({ expires_at: "2026-10-30T03:15:00Z" })).toBe(false);
  });
});

describe("uploadToStorage", () => {
  it("sends the file with the ticket's method, URL and headers, except the browser's own", async () => {
    const xhrs = installFakeXhr();
    const body = file();

    const upload = uploadToStorage(ticket(), body);
    const xhr = xhrs.last();
    xhr.respond(200);
    await upload;

    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("http://storage.test/products/p1/img-1");
    expect(xhr.headers).toEqual({
      "Content-Type": "image/jpeg",
      "x-amz-meta-image": "img-1",
    });
    expect(xhr.body).toBe(body);
    expect(xhr.responseType).toBe("text");
  });

  it("reports progress, with the file's size when the total is unknown, and 100% at the end", async () => {
    const xhrs = installFakeXhr();
    const onProgress = vi.fn();

    const upload = uploadToStorage(ticket(), file(), { onProgress });
    xhrs.last().progress(1, 8);
    xhrs.last().progress(2, 0, false);
    xhrs.last().respond(204);
    await upload;

    expect(onProgress.mock.calls).toEqual([
      [1, 8],
      [2, 4],
      [4, 4],
    ]);
  });

  it.each([200, 201, 299])("resolves on %d", async (status) => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(ticket(), file());
    xhrs.last().respond(status);

    await expect(upload).resolves.toBeUndefined();
  });

  it("calls a 403 that says it expired 'expired', with S3's code", async () => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(
      ticket({ expires_at: "2099-01-01T00:00:00Z" }),
      file(),
    );
    xhrs.last().respond(403, s3Error("AccessDenied", "Request has expired"));

    const error = await failure(upload);
    expect(error.kind).toBe("expired");
    expect(error.status).toBe(403);
    expect(error.storageCode).toBe("AccessDenied");
    expect(error.message).toBe("upload to storage failed: expired (HTTP 403)");
  });

  it("calls a 403 ExpiredToken 'expired'", async () => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(
      ticket({ expires_at: "2099-01-01T00:00:00Z" }),
      file(),
    );
    // A message without the word: the code alone says it.
    xhrs
      .last()
      .respond(403, s3Error("ExpiredToken", "The token is no longer valid."));

    expect((await failure(upload)).kind).toBe("expired");
  });

  it("calls a 403 'expired' when the clock says the URL ran out, whatever the body", async () => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(
      ticket({ expires_at: "2000-01-01T00:00:00Z" }),
      file(),
    );
    xhrs.last().respond(403, "");

    expect((await failure(upload)).kind).toBe("expired");
  });

  it("calls any other 403 'rejected', keeping the storage's code", async () => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(
      ticket({ expires_at: "2099-01-01T00:00:00Z" }),
      file(),
    );
    xhrs
      .last()
      .respond(
        403,
        s3Error("SignatureDoesNotMatch", "The signature does not match"),
      );

    const error = await failure(upload);
    expect(error.kind).toBe("rejected");
    expect(error.storageCode).toBe("SignatureDoesNotMatch");
  });

  it("calls a 400 without an XML body 'rejected', without a code", async () => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(ticket(), file());
    xhrs.last().respond(400, "Bad Request");

    const error = await failure(upload);
    expect(error.kind).toBe("rejected");
    expect(error.status).toBe(400);
    expect(error.storageCode).toBeUndefined();
  });

  it.each([199, 300, 304])(
    "calls %d, outside 2xx, 'rejected'",
    async (status) => {
      const xhrs = installFakeXhr();

      const upload = uploadToStorage(ticket(), file());
      xhrs.last().respond(status);

      const error = await failure(upload);
      expect(error.kind).toBe("rejected");
      expect(error.status).toBe(status);
    },
  );

  it.each([500, 503])("calls %d 'unavailable'", async (status) => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(ticket(), file());
    xhrs
      .last()
      .respond(status, s3Error("SlowDown", "Reduce your request rate"));

    const error = await failure(upload);
    expect(error.kind).toBe("unavailable");
    expect(error.status).toBe(status);
  });

  it("calls a dropped connection 'network', with status 0", async () => {
    const xhrs = installFakeXhr();

    const upload = uploadToStorage(ticket(), file());
    xhrs.last().fail();

    const error = await failure(upload);
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
    expect(error.message).toBe("upload to storage failed: network");
  });

  it("aborts the request when the signal does, rejecting 'aborted'", async () => {
    const xhrs = installFakeXhr();
    const controller = new AbortController();

    const upload = uploadToStorage(ticket(), file(), {
      signal: controller.signal,
    });
    controller.abort();

    expect((await failure(upload)).kind).toBe("aborted");
    expect(xhrs.last().aborted).toBe(true);
  });

  it("sends nothing for a signal already aborted", async () => {
    const xhrs = installFakeXhr();
    const controller = new AbortController();
    controller.abort();

    const error = await failure(
      uploadToStorage(ticket(), file(), { signal: controller.signal }),
    );

    expect(error.kind).toBe("aborted");
    expect(xhrs.instances).toHaveLength(0);
  });

  it("stops listening to the signal once settled", async () => {
    const xhrs = installFakeXhr();
    const controller = new AbortController();

    const upload = uploadToStorage(ticket(), file(), {
      signal: controller.signal,
    });
    xhrs.last().respond(200);
    await upload;
    controller.abort();

    expect(xhrs.last().aborted).toBe(false);
  });
});
