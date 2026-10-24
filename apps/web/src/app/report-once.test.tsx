// The storefront as main.tsx starts it: the real createRoot options
// (onCaughtError), the real App (RouterProvider's onError), and a route
// that throws. An error must reach the console once, not twice. One
// scenario per file: main.tsx renders once, when it is first imported.
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
/** What the broken route throws in this file's test. */
const state = vi.hoisted((): { thrown: unknown } => ({ thrown: undefined }));

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
// One copy of the router's context for App and the routes (see App.test).
vi.mock("react-router/dom", async () => {
  const { RouterProvider } = await import("react-router");
  return { RouterProvider };
});
vi.mock("@/app/routes.tsx", async () => {
  const { RouteErrorPage } = await import("@/app/RouteErrorPage.tsx");
  function Broken(): never {
    throw state.thrown;
  }
  return {
    routes: [{ path: "/", Component: Broken, ErrorBoundary: RouteErrorPage }],
  };
});

/** Starts the storefront with main.tsx and waits for the error page. */
const boot = async (error: unknown) => {
  state.thrown = error;
  document.body.innerHTML = '<div id="root"></div>';
  await import("@/main.tsx");
  return screen.findByRole("heading", { level: 1 }, { timeout: 3_000 });
};

let log: MockInstance<typeof console.error>;
const actEnvironment: unknown = Reflect.get(
  globalThis,
  "IS_REACT_ACT_ENVIRONMENT",
);

beforeEach(() => {
  // main.tsx renders outside act(), as in the browser.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  log = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
  vi.restoreAllMocks();
});

describe("an error a route's boundary catches", () => {
  it("renders the error page and is logged exactly once", async () => {
    const error = new TypeError("x is undefined");

    expect((await boot(error)).textContent).toBe("Terjadi kesalahan");

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe(error);
  });
});
