import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMock, product, productResponse, serve } from "@/test/fake-api.ts";
import { renderApp } from "@/test/render.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
  serve((url) =>
    url.pathname === "/v1/products/kaos"
      ? productResponse(product("kaos", { name: "Kaos" }))
      : undefined,
  );
});

describe("the lazy routes", () => {
  it.each([
    ["/masuk", "Masuk"],
    ["/daftar", "Daftar akun"],
    ["/produk/kaos", "Kaos"],
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
