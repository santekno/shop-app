// A short message shown over the app for a few seconds: "Wishlist penuh".
// Not a TanStack Query concern and not worth a state library, so it is a
// module-level value that React reads with useSyncExternalStore (the same
// hook the connection banner uses for onlineManager). <NoticeHost> in the
// root layout draws it.
import { useSyncExternalStore } from "react";

export interface Notice {
  /** Changes with every notice, so the same sentence twice still replays. */
  id: number;
  message: string;
}

/** How long a notice stays, in ms. */
export const NOTICE_MS = 4_000;

let current: Notice | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Shows `message`, replacing a notice already on screen. */
export const showNotice = (message: string, ms: number = NOTICE_MS): void => {
  if (timer !== undefined) clearTimeout(timer);
  current = { id: nextId, message };
  nextId += 1;
  timer = setTimeout(dismissNotice, ms);
  emit();
};

/** Removes the notice, if any. */
export const dismissNotice = (): void => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (current === null) return;
  current = null;
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => current;

/** The notice on screen, or null. */
export const useNotice = (): Notice | null =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
