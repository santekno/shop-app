// Names the JS chunks Vite writes to /assets/: "<name>-<hash>.js", where the
// hash is always 8 base64url characters and may itself contain "-"
// ("index-D-d-RXfr.js"), so only a fixed-length hash at the end can be cut
// off safely.
const CHUNK = /\/assets\/(.+)-[\w-]{8}\.js$/;

/** The chunk's name without its hash, or undefined for anything else. */
export const chunkName = (pathname: string): string | undefined =>
  CHUNK.exec(pathname)?.[1];
