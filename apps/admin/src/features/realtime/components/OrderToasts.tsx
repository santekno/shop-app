import { ShoppingBag, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button.tsx";
import { MAIN_ID } from "@/app/useRouteFocus.ts";
import { useDocumentVisible } from "../hooks/useDocumentVisible.ts";
import { ORDERS_PATH, useOrderEventsContext } from "../order-events-context.ts";
import type { OrderToast } from "../toasts.ts";

/** How long a toast stays, counted only while nothing pauses it. */
export const TOAST_DURATION_MS = 8_000;

/**
 * The new-order notifications: a polite live region that tells a screen
 * reader, and a stack of toasts in the corner for the eye and the
 * keyboard.
 *
 * Two parts, because a live region reads everything added to it: a toast
 * inside one would be announced as "Pesanan baru GS-… Lihat pesanan Tutup
 * notifikasi". The region holds only the sentence; the stack is a named
 * region (landmark) with real links and buttons.
 *
 * Nothing here ever moves the focus by itself: a toast arrives while the
 * seller may be typing in a form. Only dismissing the toast that has the
 * focus moves it (to the next toast, or to the page), so it does not fall
 * to <body>.
 */
export function OrderToasts() {
  const { toasts, announcement } = useOrderEventsContext();
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {toasts.length > 0 && <ToastStack toasts={toasts} />}
    </>
  );
}

function ToastStack({ toasts }: { toasts: readonly OrderToast[] }) {
  const { dismissToast } = useOrderEventsContext();
  const visible = useDocumentVisible();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  // Timers stop while the pointer is over the stack (reading it), while
  // the focus is in it (about to press something), and while the tab is
  // hidden (nobody is looking): WCAG 2.2.1, time the user can extend.
  const paused = hovered || focused || !visible;

  /** Dismisses a toast; if it had the focus, hands the focus on first. */
  const dismiss = (id: string) => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(
      `[data-toast-id="${CSS.escape(id)}"]`,
    );
    if (item?.contains(document.activeElement) === true) {
      const next =
        item.nextElementSibling ?? item.previousElementSibling ?? null;
      const target =
        next?.querySelector<HTMLElement>("[data-toast-close]") ??
        document.getElementById(MAIN_ID);
      target?.focus({ preventScroll: true });
    }
    dismissToast(id);
  };

  return (
    <section
      aria-label="Notifikasi pesanan"
      className="fixed right-4 bottom-4 z-50 w-[min(24rem,calc(100vw-2rem))]"
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <ol ref={listRef} className="grid gap-2">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            paused={paused}
            onDismiss={dismiss}
          />
        ))}
      </ol>
    </section>
  );
}

interface ToastItemProps {
  toast: OrderToast;
  paused: boolean;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, paused, onDismiss }: ToastItemProps) {
  // Time left, kept across pauses: a ref, because changing it renders
  // nothing.
  const remaining = useRef(TOAST_DURATION_MS);
  const expire = useEffectEvent(() => {
    onDismiss(toast.id);
  });

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(expire, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onDismiss(toast.id);
    }
  };

  return (
    <li
      data-toast-id={toast.id}
      onKeyDown={onKeyDown}
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg"
    >
      <ShoppingBag aria-hidden="true" className="mt-0.5 size-5 text-primary" />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="text-sm font-medium break-words">{toast.message}</p>
        <Link
          to={ORDERS_PATH}
          className="w-fit text-sm"
          onClick={() => {
            onDismiss(toast.id);
          }}
        >
          Lihat pesanan
        </Link>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="-mt-1 -mr-1 size-8"
        data-toast-close=""
        onClick={() => {
          onDismiss(toast.id);
        }}
      >
        <X aria-hidden="true" />
        <span className="sr-only">Tutup notifikasi {toast.message}</span>
      </Button>
    </li>
  );
}
