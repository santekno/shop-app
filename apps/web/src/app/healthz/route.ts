/**
 * GET /healthz: the liveness probe of Docker and Railway (artikel 14). It
 * touches neither the API nor any file: a storefront whose API is down
 * still serves pages, and restarting it would not bring the API back.
 */
export const GET = () =>
  new Response("ok", {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
