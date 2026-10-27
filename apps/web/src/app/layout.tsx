import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "@/components/layout/Providers.tsx";
import { SiteFrame } from "@/components/layout/SiteFrame.tsx";
import "@/index.css";

/**
 * What every page's <head> gets unless the page says otherwise. A page's
 * `title` fills the template: "Keranjang" becomes "Keranjang — GoShop".
 */
export const metadata: Metadata = {
  title: { default: "GoShop", template: "%s — GoShop" },
  description: "GoShop: toko online contoh dari kursus Fullstack Santekno.",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  // Both themes are supported: before the CSS arrives, the browser paints
  // the page in the device's scheme, not always white.
  colorScheme: "light dark",
};

/**
 * The root layout: the one <html> and <body> of every page (Bab 11
 * artikel 08), what index.html and main.tsx were for the Vite app. It is a
 * server component: it runs on the server for each request and sends
 * HTML; its own code never reaches the browser. The interactive parts
 * (the providers, the header, the focus handling) are client components
 * it renders; the page comes in as `children`.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The CSP nonce src/proxy.ts made for this request. Next.js puts it on
  // its own scripts by itself; reading a request header also makes every
  // page render per request, which a nonce needs (a page cached once
  // would carry one nonce for every visitor).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // suppressHydrationWarning: theme.js sets data-theme on <html> before
    // React hydrates, so the attribute differs from the server's HTML on
    // purpose. It applies to this element's own attributes only.
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* The saved theme, applied before the first paint: a plain
            script (no async, no defer) blocks rendering for the few lines
            it runs. A file from our origin, allowed by script-src 'self',
            rather than inline code (public/theme.js says why). The rule
            below warns against exactly this blocking: here it is the
            point, and the file is a few hundred bytes. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" nonce={nonce} />
      </head>
      <body>
        <Providers>
          <SiteFrame>{children}</SiteFrame>
        </Providers>
      </body>
    </html>
  );
}
