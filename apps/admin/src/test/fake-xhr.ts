// A stand-in for XMLHttpRequest, for the photo upload's PUT to storage
// (features/products/upload-to-storage.ts). XHR is what reports upload
// progress; a test drives it step by step:
//
//   const xhrs = installFakeXhr();   // for this test (unstubGlobals)
//   … the code under test sends …
//   xhrs.last().progress(50, 100);
//   xhrs.last().respond(200);
//
// Only the parts the upload uses: open, setRequestHeader, responseType,
// upload.onprogress, onload, onerror, onabort, status, responseText, send
// and abort. Nothing reaches the network.
import { vi } from "vitest";

export class FakeXhr {
  method = "";
  url = "";
  readonly headers: Record<string, string> = {};
  body: Document | XMLHttpRequestBodyInit | null = null;
  responseType: XMLHttpRequestResponseType = "";
  status = 0;
  responseText = "";
  sent = false;
  aborted = false;
  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null) {
    this.body = body;
    this.sent = true;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  /** Bytes leave the browser. */
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({
      loaded,
      total,
      lengthComputable,
    } as ProgressEvent);
  }

  /** The storage answers. */
  respond(status: number, body = "") {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }

  /** No answer at all: the connection dropped, or CORS refused it. */
  fail() {
    this.onerror?.();
  }
}

/** Replaces XMLHttpRequest for one test; returns every instance made. */
export const installFakeXhr = () => {
  const instances: FakeXhr[] = [];
  vi.stubGlobal(
    "XMLHttpRequest",
    class extends FakeXhr {
      constructor() {
        super();
        instances.push(this);
      }
    },
  );
  return {
    instances,
    last: (): FakeXhr => {
      const xhr = instances.at(-1);
      if (xhr === undefined) throw new Error("no XMLHttpRequest was made");
      return xhr;
    },
  };
};

/** The S3 error body an expired presigned URL gets. */
export const s3Error = (code: string, message: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
