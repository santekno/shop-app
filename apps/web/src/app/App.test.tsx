import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categoriesResponse, category, fetchMock } from "@/test/fake-api.ts";
import { App } from "./App.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
});

describe("App", () => {
  it("renders the site heading and the category section", async () => {
    fetchMock.mockResolvedValue(categoriesResponse([category("1", "Pakaian")]));

    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "GoShop" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Toko online contoh dari kursus Fullstack Santekno."),
    ).toBeTruthy();
    const main = screen.getByRole("main");
    expect(
      screen
        .getByRole("heading", { level: 2, name: "Kategori" })
        .closest("main"),
    ).toBe(main);
    expect(await screen.findByText("Pakaian")).toBeTruthy();
  });
});
