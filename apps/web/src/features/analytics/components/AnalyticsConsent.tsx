"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { setAnalyticsConsent, useAnalyticsConsent } from "../consent.ts";
import type { AnalyticsConsent as Consent } from "../consent.ts";

/**
 * The consent banner and the footer's "Pengaturan analytics" button (Bab
 * 11 artikel 13). SiteFrame renders it only when GA_MEASUREMENT_ID is
 * set: a shop without analytics has nothing to ask.
 *
 * The banner shows when the buyer has not answered yet, or after they
 * press "Pengaturan analytics" to change the answer. Either button
 * applies the answer at once (Consent Mode's `update`) and remembers it.
 *
 * Accessibility:
 * - a region named by its heading, so it is in the landmarks list;
 * - real buttons, reachable with Tab, with the choice in their text;
 * - non-modal, and it does not take the focus when it appears by itself:
 *   a buyer reading or typing is not interrupted, and can answer later or
 *   never (no answer means "denied"). Opened from the footer button, it
 *   does take the focus, because the buyer asked for it; closing it
 *   returns the focus to that button. Answering the banner that showed by
 *   itself also moves the focus there, if it was in the banner.
 * - fixed to the bottom of the screen, but its measured height is kept
 *   free under the page (the spacer below), so the last thing on a page,
 *   such as checkout's "Buat pesanan & bayar" on a phone, can always be
 *   scrolled above it. On a wider screen it is a small card in the
 *   corner. Fixed rather than in the page's flow: a banner pushed into
 *   the page after hydration would move everything below it, a layout
 *   shift (CLS, artikel 12).
 *
 * It is not in the server's HTML: the stored answer is known only in the
 * browser (useAnalyticsConsent is undefined until then).
 */
export function AnalyticsConsent() {
  const consent = useAnalyticsConsent();
  // Opened from the footer button to change an earlier answer.
  const [editing, setEditing] = useState(false);
  const headingId = useId();
  const bannerId = useId();
  const banner = useRef<HTMLElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const open = consent === null || editing;
  // The banner's height, measured, for the spacer: it depends on the
  // screen's width and the text size, so no fixed number would do.
  const [bannerHeight, setBannerHeight] = useState(0);

  useEffect(() => {
    const element = banner.current;
    if (!open || element === null) return;
    const observer = new ResizeObserver(() => {
      setBannerHeight(element.offsetHeight);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [open]);

  // The buyer pressed "Pengaturan analytics": the banner appears and gets
  // the focus, so a keyboard or screen reader user lands on it.
  useEffect(() => {
    if (editing) banner.current?.focus();
  }, [editing]);

  const close = () => {
    if (!editing) return;
    setEditing(false);
    settingsButton.current?.focus();
  };

  const answer = (choice: Consent) => {
    // The banner that showed by itself unmounts with the button just
    // pressed; the focus would fall to <body>. It goes to the footer
    // button that brings the banner back.
    const focusInside = banner.current?.contains(document.activeElement);
    setAnalyticsConsent(choice);
    if (editing) close();
    else if (focusInside) settingsButton.current?.focus();
  };

  return (
    <>
      {/* Undefined until the browser has read the stored answer. */}
      {consent !== undefined && (
        <Button
          ref={settingsButton}
          variant="link"
          className="text-sm text-muted-foreground"
          aria-expanded={open}
          aria-controls={open ? bannerId : undefined}
          onClick={() => {
            setEditing(true);
          }}
        >
          Pengaturan analytics
        </Button>
      )}
      {open && (
        <>
          {/* Keeps the banner's height free under the page: the page can
              always be scrolled so that nothing is left behind it. */}
          <div aria-hidden="true" style={{ height: bannerHeight }} />
          <section
            ref={banner}
            id={bannerId}
            aria-labelledby={headingId}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
            }}
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card p-4 text-card-foreground shadow-lg focus:outline-none md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm md:rounded-lg md:border"
          >
            <h2 id={headingId} className="text-base font-semibold">
              Izinkan analytics?
            </h2>
            <p className="mt-1 text-sm">
              GoShop memakai Google Analytics untuk tahu produk dan halaman mana
              yang dilihat, tanpa nama, email, atau alamat Anda. Bila ditolak,
              tidak ada cookie analytics; Google hanya menerima hitungan tanpa
              cookie.
            </p>
            {editing && consent !== null && consent !== undefined && (
              <p className="mt-1 text-sm text-muted-foreground">
                Pilihan Anda sekarang:{" "}
                {consent === "granted" ? "diizinkan" : "ditolak"}.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  answer("granted");
                }}
              >
                Izinkan
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  answer("denied");
                }}
              >
                Tolak
              </Button>
              {editing && (
                <Button size="sm" variant="ghost" onClick={close}>
                  Tutup
                </Button>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
