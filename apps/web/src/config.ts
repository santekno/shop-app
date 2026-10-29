/** The API the dev server talks to when NEXT_PUBLIC_API_URL is not set. */
const DEV_API_URL = "http://localhost:8080";

/**
 * The API's base URL as the browser reaches it. Next.js replaces
 * `process.env.NEXT_PUBLIC_API_URL` with its value at build time (only a
 * literal `process.env.NEXT_PUBLIC_…` is replaced, never a computed name),
 * so the value is public and must never be a secret. next.config.ts
 * refuses a production build without it.
 *
 * The server reaches the API at its own address (API_INTERNAL_URL,
 * lib/server-config.ts), which this file never reads: it runs in the
 * browser too.
 */
const readApiUrl = (): string => {
  const value = process.env.NEXT_PUBLIC_API_URL;
  if (value !== undefined && value !== "") return value;
  if (process.env.NODE_ENV !== "production") return DEV_API_URL;
  throw new Error("NEXT_PUBLIC_API_URL is not set");
};

export const config = {
  apiUrl: readApiUrl(),
} as const;
