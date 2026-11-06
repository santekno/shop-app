import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import {
  fireEvent,
  screen,
  userEvent,
  waitFor,
} from "@testing-library/react-native";
import { Dimensions } from "react-native";

import { apiError, fakeApi, json } from "@/test/fake-api";
import { scrollView } from "@/test/list";
import { renderWithProviders } from "@/test/render";
import type { Banner } from "../api/banners";
import { BannerCarousel } from "./BannerCarousel";

let sequence = 0;
const banner = (title: string, overrides: Partial<Banner> = {}): Banner => {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    title,
    subtitle: null,
    cta_label: null,
    link_category_slug: null,
    background_color: "#1E40AF",
    ...overrides,
  };
};

const answer = (banners: Banner[]) => {
  fakeApi.on("GET", "/v1/banners", () => json({ data: banners }));
};

const renderCarousel = (onOpenCategory = jest.fn<(slug: string) => void>()) =>
  renderWithProviders(
    <BannerCarousel onOpenCategory={onOpenCategory} bleed={16} />,
  ).then((result) => ({ ...result, onOpenCategory }));

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("BannerCarousel", () => {
  it("draws nothing when the shop has no banner", async () => {
    answer([]);
    const { toJSON } = await renderCarousel();

    await waitFor(() => {
      expect(fakeApi.requests("GET", "/v1/banners")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
    expect(toJSON()).toBeNull();
  });

  it("shows a 144 dp loading box while the banners load", async () => {
    answer([banner("A")]);
    await renderCarousel();

    expect(
      screen.getByRole("progressbar", { name: "Memuat banner…" }),
    ).toBeTruthy();
    expect(await screen.findByText("A")).toBeTruthy();
  });

  it("a banner with a category is a button that opens it", async () => {
    answer([
      banner("Kaos Baru", {
        subtitle: "Musim ini",
        cta_label: "Lihat kaos",
        link_category_slug: "kaos",
      }),
    ]);
    const { onOpenCategory } = await renderCarousel();

    const card = await screen.findByRole("button", {
      name: "Banner 1 dari 1. Kaos Baru. Musim ini. Lihat kaos",
    });
    expect(screen.getByText("Lihat kaos")).toBeTruthy();
    await userEvent.press(card);

    expect(onOpenCategory).toHaveBeenCalledTimes(1);
    expect(onOpenCategory).toHaveBeenCalledWith("kaos");
  });

  it("a category banner without a button label is still announced with 'Lihat produk'", async () => {
    answer([banner("Diskon", { link_category_slug: "celana" })]);
    await renderCarousel();

    expect(
      await screen.findByRole("button", {
        name: "Banner 1 dari 1. Diskon. Lihat produk",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Lihat produk")).toBeNull();
  });

  it("a banner that links nowhere is not a button, and has no empty parts in its label", async () => {
    answer([banner("Gratis ongkir")]);
    await renderCarousel();

    expect(await screen.findByText("Gratis ongkir")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByLabelText("Banner 1 dari 1. Gratis ongkir"),
    ).toBeTruthy();
  });

  it("the dots follow the page the scroll came to rest on", async () => {
    answer([banner("Satu"), banner("Dua"), banner("Tiga")]);
    await renderCarousel();
    await screen.findByText("Satu");

    const longDots = () =>
      screen.container.queryAll(
        (i) =>
          typeof i.props.className === "string" &&
          i.props.className.includes("h-2 w-5"),
      );
    const dotClasses = () =>
      screen.container
        .queryAll(
          (i) =>
            typeof i.props.className === "string" &&
            i.props.className.includes("rounded-full") &&
            i.props.className.includes("h-2"),
        )
        .map((i) => (i.props.className as string).includes("w-5"));

    expect(dotClasses()).toEqual([true, false, false]);
    const { width } = Dimensions.get("window");
    await fireEvent(scrollView(), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: width * 2 } },
    });

    await waitFor(() => {
      expect(dotClasses()).toEqual([false, false, true]);
    });
    expect(longDots()).toHaveLength(1);
  });

  it("failed: shows the error, and Coba lagi loads the banners", async () => {
    fakeApi.once("GET", "/v1/banners", () => apiError(500, "INTERNAL", "r-3"));
    answer([banner("Pulih")]);
    await renderCarousel();

    await userEvent.press(
      await screen.findByRole("button", { name: "Coba lagi" }),
    );

    expect(await screen.findByText("Pulih")).toBeTruthy();
    expect(fakeApi.requests("GET", "/v1/banners")).toHaveLength(2);
  });

  it("offline at start: waits for the connection instead of failing", async () => {
    onlineManager.setOnline(false);
    answer([banner("Nanti")]);
    await renderCarousel();

    expect(
      await screen.findByText(
        "Tidak ada koneksi internet. Banner dimuat begitu koneksi kembali.",
      ),
    ).toBeTruthy();
    expect(fakeApi.requests("GET", "/v1/banners")).toHaveLength(0);
  });
});
