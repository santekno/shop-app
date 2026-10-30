/** The API the dev server talks to when VITE_API_URL is not set. */
const DEV_API_URL = "http://localhost:8080";

/**
 * The API's base URL. Vite replaces `import.meta.env.VITE_API_URL` with its
 * value at build time; the value is public, so it must never be a secret.
 */
const readApiUrl = (): string => {
  const value = import.meta.env.VITE_API_URL;
  if (value !== undefined && value !== "") return value;
  if (import.meta.env.DEV) return DEV_API_URL;
  // vite.config.ts refuses a production build without it, so this only
  // fires for an unusual build mode.
  throw new Error("VITE_API_URL is not set");
};

export const config = {
  apiUrl: readApiUrl(),
} as const;
