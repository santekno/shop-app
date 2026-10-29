// A window.location whose assign() and reload() a test can read back.
//
// jsdom cannot leave the document: location.assign(url) to another page
// prints "Not implemented: navigation" and the URL is lost. Its Location
// methods cannot be spied on either (they are non-configurable own
// properties). What Vitest's jsdom environment does allow is replacing
// the global `location` itself, and `window` is the global object:
//
//   const location = stubLocation();
//   … the code under test calls window.location.assign(url) …
//   expect(location.assign).toHaveBeenCalledWith(url);
//
// Everything else (href, pathname, …) is read from the real location, so
// the memory router and history.replaceState keep working. vi.stubGlobal
// lasts one test (vite.config.ts sets unstubGlobals).
import { vi } from "vitest";

export const stubLocation = () => {
  const real = window.location;
  const assign = vi.fn<(url: string | URL) => void>();
  const reload = vi.fn<() => void>();
  // The target is an empty object, not the real location: a Proxy must
  // return a non-configurable property's own value, and jsdom's assign
  // and reload are non-configurable.
  const stub = new Proxy({} as Location, {
    get(_, key) {
      if (key === "assign") return assign;
      if (key === "reload") return reload;
      const value: unknown = Reflect.get(real, key, real);
      return typeof value === "function"
        ? (value.bind(real) as unknown)
        : value;
    },
  });
  vi.stubGlobal("location", stub);
  return { assign, reload };
};
