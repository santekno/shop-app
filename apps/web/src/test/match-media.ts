// jsdom has no window.matchMedia. A stand-in for the device's
// prefers-color-scheme, which a test can flip like a phone at sunset:
//
//   const device = stubColorScheme("light");
//   act(() => { device.set("dark"); });
import { vi } from "vitest";

export const stubColorScheme = (initial: "light" | "dark") => {
  let dark = initial === "dark";
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const queries: string[] = [];

  const matchMedia = (query: string): MediaQueryList => {
    queries.push(query);
    // Only the query useTheme asks; anything else never matches.
    const isDarkQuery = query === "(prefers-color-scheme: dark)";
    // The parts useTheme uses; the deprecated addListener pair is left out.
    const list: Pick<
      MediaQueryList,
      | "media"
      | "matches"
      | "onchange"
      | "addEventListener"
      | "removeEventListener"
      | "dispatchEvent"
    > = {
      media: query,
      get matches() {
        return isDarkQuery && dark;
      },
      onchange: null,
      addEventListener: (_type: string, listener: unknown) => {
        if (isDarkQuery) {
          listeners.add(listener as (event: MediaQueryListEvent) => void);
        }
      },
      removeEventListener: (_type: string, listener: unknown) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      dispatchEvent: () => true,
    };
    return list as MediaQueryList;
  };
  // vite.config.ts sets unstubGlobals, so this lasts for one test.
  vi.stubGlobal("matchMedia", matchMedia);

  return {
    /** The device switches theme; every listener hears "change". */
    set: (scheme: "light" | "dark") => {
      dark = scheme === "dark";
      for (const listener of listeners) {
        listener({ matches: dark } as MediaQueryListEvent);
      }
    },
    /** How many "change" listeners are attached now. */
    listenerCount: () => listeners.size,
    queries,
  };
};
