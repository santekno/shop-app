// A real PNG made in memory, for the specs that upload a product photo:
// the API checks the file's first bytes and its size before the worker
// resizes it, so a stand-in must be a decodable image. Node's zlib and a
// CRC table are all a PNG needs; no image library.
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/**
 * An 8-bit RGB PNG of width × height: a diagonal gradient, so the
 * resized variants are not one flat colour.
 */
export const pngImage = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  // compression, filter and interlace stay 0.
  const row = 1 + width * 3;
  const pixels = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    pixels[y * row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const at = y * row + 1 + x * 3;
      pixels[at] = (x * 255) / width;
      pixels[at + 1] = (y * 255) / height;
      pixels[at + 2] = 160;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
