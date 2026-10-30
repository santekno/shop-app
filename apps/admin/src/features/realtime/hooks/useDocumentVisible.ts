import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
  };
};

const isVisible = () => document.visibilityState === "visible";

/**
 * Whether this tab is on screen (the Page Visibility API). A toast that
 * arrives while the seller is in another tab waits for them: its
 * auto-dismiss timer only runs while this is true.
 */
export const useDocumentVisible = (): boolean =>
  useSyncExternalStore(subscribe, isVisible);
