// The pages that render only in the browser (client-pages.tsx): each one's
// code is a chunk of its own, downloaded on the first visit.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMock } from "@/test/fake-api.ts";
import { renderApp } from "@/test/render.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => undefined));
});

describe("the browser-only pages", () => {
  it.each([
    ["/masuk", "Masuk"],
    ["/daftar", "Daftar akun"],
    ["/keranjang", "Keranjang"],
  ])(
    "show Memuat GoShop… for a first visit to %s until its code has loaded",
    async (url, heading) => {
      renderApp(url);

      expect(screen.getByRole("status").textContent).toBe("Memuat GoShop…");
      expect(
        await screen.findByRole("heading", { level: 1, name: heading }),
      ).toBeTruthy();
      expect(screen.queryByText("Memuat GoShop…")).toBeNull();
    },
  );
});
