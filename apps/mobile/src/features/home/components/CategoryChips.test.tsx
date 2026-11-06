import { describe, expect, it, jest } from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import { screen, userEvent } from "@testing-library/react-native";

import { apiError, fakeApi, json } from "@/test/fake-api";
import { category } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { CategoryChips } from "./CategoryChips";

const renderChips = () => {
  const onOpenCategory = jest.fn<(slug: string) => void>();
  return renderWithProviders(
    <CategoryChips onOpenCategory={onOpenCategory} bleed={16} />,
  ).then((result) => ({ ...result, onOpenCategory }));
};

describe("CategoryChips", () => {
  it("shows the top-level categories only, and a tap opens its slug", async () => {
    const kaos = category("kaos", "Kaos");
    fakeApi.on("GET", "/v1/categories", () =>
      json({
        data: [
          kaos,
          category("celana", "Celana"),
          category("polo", "Polo", kaos.id),
        ],
      }),
    );
    const { onOpenCategory } = await renderChips();

    expect(
      await screen.findByRole("header", { name: "Kategori" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Kategori Kaos" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Kategori Celana" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kategori Polo" })).toBeNull();

    await userEvent.press(
      screen.getByRole("button", { name: "Kategori Celana" }),
    );
    expect(onOpenCategory).toHaveBeenCalledTimes(1);
    expect(onOpenCategory).toHaveBeenCalledWith("celana");
  });

  it("says so when there is no category", async () => {
    fakeApi.on("GET", "/v1/categories", () => json({ data: [] }));
    await renderChips();

    expect(await screen.findByText("Belum ada kategori.")).toBeTruthy();
  });

  it("a failure shows the error with Coba lagi, which reloads", async () => {
    fakeApi.once("GET", "/v1/categories", () =>
      apiError(500, "INTERNAL", "r-2"),
    );
    fakeApi.on("GET", "/v1/categories", () =>
      json({ data: [category("kaos", "Kaos")] }),
    );
    await renderChips();

    await userEvent.press(
      await screen.findByRole("button", { name: "Coba lagi" }),
    );

    expect(
      await screen.findByRole("button", { name: "Kategori Kaos" }),
    ).toBeTruthy();
  });

  it("offline at start says the categories load when the connection returns", async () => {
    onlineManager.setOnline(false);
    fakeApi.on("GET", "/v1/categories", () => json({ data: [] }));
    await renderChips();

    expect(
      await screen.findByText(
        "Tidak ada koneksi internet. Kategori dimuat begitu koneksi kembali.",
      ),
    ).toBeTruthy();
    onlineManager.setOnline(true);
  });
});
