import "server-only";
import { config } from "@/config.ts";

/**
 * Settings only the storefront's server reads, from its environment when
 * it runs (not at build time): one image can run against any API.
 *
 * `import "server-only"` makes the build fail if a client component ever
 * imports this file, so a server-only value can never be bundled into
 * the browser's JavaScript by accident.
 */
const internalApiUrl = process.env.API_INTERNAL_URL;

export const serverConfig = {
  /**
   * The API as this server reaches it: inside Docker Compose or a private
   * network that is another address than the browser's (http://api:8080).
   * Unset means the public URL.
   */
  apiUrl:
    internalApiUrl !== undefined && internalApiUrl !== ""
      ? internalApiUrl
      : config.apiUrl,
} as const;
