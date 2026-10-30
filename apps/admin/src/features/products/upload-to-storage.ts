import type { ImageUploadTicket } from "@goshop/shared";

/**
 * Why an upload to the storage failed:
 *
 * - `expired`: the presigned URL's 15 minutes are over (the storage says
 *   so, or the clock already did). A retry needs a new URL.
 * - `rejected`: the storage answered 4xx for another reason (a signature
 *   that does not match, a bucket policy).
 * - `unavailable`: the storage answered 5xx.
 * - `network`: no answer at all: the connection dropped, or the browser
 *   blocked the request (a CORS or CSP refusal looks exactly the same to a
 *   page, on purpose).
 * - `aborted`: the seller cancelled it.
 */
export type StorageUploadErrorKind =
  "expired" | "rejected" | "unavailable" | "network" | "aborted";

/** The one error uploadToStorage rejects with. */
export class StorageUploadError extends Error {
  readonly kind: StorageUploadErrorKind;
  /** The storage's HTTP status, or 0 when no answer arrived. */
  readonly status: number;
  /** The S3 error code from the answer's XML (`AccessDenied`), if any. */
  readonly storageCode: string | undefined;

  constructor(kind: StorageUploadErrorKind, status = 0, storageCode?: string) {
    super(
      `upload to storage failed: ${kind}${status > 0 ? ` (HTTP ${status})` : ""}`,
    );
    this.name = "StorageUploadError";
    this.kind = kind;
    this.status = status;
    this.storageCode = storageCode;
  }
}

/**
 * Headers a page may not set: the browser computes them itself. The
 * presigned request lists `Content-Length` because it is signed, and the
 * browser sends exactly the body's size, which is the declared size.
 */
const BROWSER_OWNED_HEADERS = new Set(["content-length", "host"]);

/** `<Code>AccessDenied</Code>` and `<Message>…</Message>` from an S3 error body. */
const xmlField = (body: string, field: string): string | undefined =>
  new RegExp(`<${field}>([^<]*)</${field}>`).exec(body)?.[1];

/** Whether the presigned URL has (nearly) run out: less than `marginMs` left. */
export const isTicketExpired = (
  ticket: Pick<ImageUploadTicket, "expires_at">,
  now = Date.now(),
  marginMs = 30_000,
): boolean => {
  const expiresAt = Date.parse(ticket.expires_at);
  return Number.isNaN(expiresAt) || expiresAt - now < marginMs;
};

/** What an answer of `status` with this body means. */
const failureOf = (
  status: number,
  body: string,
  ticket: ImageUploadTicket,
): StorageUploadError => {
  const code = xmlField(body, "Code");
  const message = xmlField(body, "Message") ?? "";
  if (status >= 500) return new StorageUploadError("unavailable", status, code);
  // S3 says an expired URL with 403 AccessDenied "Request has expired";
  // other stores word it differently, so the clock is asked too.
  if (
    status === 403 &&
    (/expired/i.test(message) ||
      code === "ExpiredToken" ||
      isTicketExpired(ticket, Date.now(), 0))
  ) {
    return new StorageUploadError("expired", status, code);
  }
  return new StorageUploadError("rejected", status, code);
};

interface UploadOptions {
  /** Abort it to cancel the upload. */
  signal?: AbortSignal;
  /** Called as bytes leave the browser: how many so far, of how many. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Sends `file` to the storage with the presigned request the API signed
 * (startProductImageUpload): exactly its method, URL and headers, with the
 * file as the whole body. The API never sees the bytes (ADR 0007).
 *
 * XMLHttpRequest, not fetch: fetch has no upload progress. A streaming
 * request body could count bytes, but it needs HTTP/2 and
 * `duplex: "half"`, and S3 refuses a body without a Content-Length, which
 * is signed here. XHR's `upload.onprogress` reports what has been sent,
 * on every browser.
 *
 * Resolves when the storage answered 2xx; rejects with a
 * StorageUploadError otherwise. The storage's error body is XML (S3's
 * `<Error><Code>…`), read only to tell an expired URL from other refusals.
 */
export const uploadToStorage = (
  ticket: ImageUploadTicket,
  file: Blob,
  { signal, onProgress }: UploadOptions = {},
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new StorageUploadError("aborted"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => {
      xhr.abort();
    };
    const settle = (error?: StorageUploadError) => {
      signal?.removeEventListener("abort", onAbortSignal);
      if (error === undefined) resolve();
      else reject(error);
    };

    xhr.open(ticket.method, ticket.url);
    for (const [name, value] of Object.entries(ticket.headers)) {
      if (!BROWSER_OWNED_HEADERS.has(name.toLowerCase())) {
        xhr.setRequestHeader(name, value);
      }
    }
    // The answer is read as text: an S3 error is a small XML document.
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      onProgress?.(
        event.loaded,
        event.lengthComputable ? event.total : file.size,
      );
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file.size, file.size);
        settle();
      } else {
        settle(failureOf(xhr.status, xhr.responseText, ticket));
      }
    };
    xhr.onerror = () => {
      settle(new StorageUploadError("network"));
    };
    xhr.onabort = () => {
      settle(new StorageUploadError("aborted"));
    };
    signal?.addEventListener("abort", onAbortSignal, { once: true });
    xhr.send(file);
  });
