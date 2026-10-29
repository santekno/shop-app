import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
// The login page's chunk cannot be downloaded (a deploy removed it, or the
// network dropped).
vi.mock("@/features/auth/lazy.ts", () => ({
  loadLoginPage: () => Promise.reject(new TypeError("Failed to fetch module")),
  loadRegisterPage: () =>
    Promise.reject(new TypeError("Failed to fetch module")),
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a browser-only page whose code fails to load", () => {
  it("reaches app/error.tsx, which offers a reload inside the layout", async () => {
    renderApp("/masuk");

    const alert = await screen.findByRole("alert");
    expect(screen.getByRole("main").contains(alert)).toBe(true);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(
      within(alert).getByRole("heading", {
        level: 1,
        name: "Terjadi kesalahan",
      }),
    ).toBeTruthy();
    expect(
      within(alert).getByRole("button", { name: "Muat ulang halaman" }),
    ).toBeTruthy();
  });
});
