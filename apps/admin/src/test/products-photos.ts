// Photo files and a stand-in for the browser's image decoding, for the
// photo-upload tests (artikel 04). jsdom decodes no image: `decode()` is
// missing and naturalWidth/naturalHeight are 0. stubImageDecode makes every
// new Image decode (or fail) with the size the test says.
import { vi } from "vitest";

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A file whose first bytes are a JPEG's, `size` bytes long. */
export const jpegFile = (name = "kaos.jpg", size = 2_000) => {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_HEAD.slice(0, Math.min(size, JPEG_HEAD.length)));
  return new File([bytes], name, { type: "image/jpeg" });
};

/** A PNG's bytes behind a .jpg name: the sniffed type wins. */
export const pngNamedJpeg = (name = "foto.jpg") => {
  const bytes = new Uint8Array(1_000);
  bytes.set(PNG_HEAD);
  return new File([bytes], name, { type: "image/jpeg" });
};

/** Not a photo at all, with whatever type the browser guessed. */
export const notAPhoto = (name = "foto.heic", type = "image/heic") =>
  new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type });

/** A file of `size` bytes, its content irrelevant (the size check runs first). */
export const sizedFile = (size: number, name = "besar.jpg") => {
  const file = new File([], name, { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

/**
 * Every Image created from now on decodes to `width × height`, or fails
 * to decode when `fails` is true. Lasts one test (unstubGlobals).
 */
export const stubImageDecode = ({
  width = 1200,
  height = 1200,
  fails = false,
}: { width?: number; height?: number; fails?: boolean } = {}) => {
  const sources: string[] = [];
  class FakeImage {
    naturalWidth = 0;
    naturalHeight = 0;
    #src = "";
    get src() {
      return this.#src;
    }
    set src(value: string) {
      this.#src = value;
      sources.push(value);
    }
    decode(): Promise<void> {
      if (fails) return Promise.reject(new Error("EncodingError"));
      this.naturalWidth = width;
      this.naturalHeight = height;
      return Promise.resolve();
    }
  }
  vi.stubGlobal("Image", FakeImage);
  return { sources };
};

/**
 * URL.createObjectURL / revokeObjectURL, which jsdom lacks: each file gets
 * "blob:preview-N", and every revoke is recorded.
 */
export const stubObjectUrls = () => {
  let next = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: () => {
        next += 1;
        const url = `blob:preview-${String(next)}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
      canParse: URL.canParse.bind(URL),
    }),
  );
  return { created, revoked };
};
