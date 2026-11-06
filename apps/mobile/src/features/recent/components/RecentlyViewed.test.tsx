import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { formatRupiah } from "@goshop/shared";
import { router } from "expo-router";
import { AccessibilityInfo } from "react-native";

import type { RecentItem } from "../recent-state";
import { useRecentStore } from "../store";
import { RecentlyViewed } from "./RecentlyViewed";

const item = (
  slug: string,
  name: string,
  overrides: Partial<RecentItem> = {},
): RecentItem => ({
  slug,
  name,
  image: null,
  priceFrom: 89_000,
  hasPriceRange: false,
  ...overrides,
});

const show = (items: RecentItem[], hydrated = true) => {
  useRecentStore.setState({ items, hydrated });
};

const announced = () =>
  jest.spyOn(AccessibilityInfo, "announceForAccessibility");

beforeEach(() => {
  show([], false);
  jest.spyOn(router, "push").mockImplementation(() => undefined);
  announced().mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RecentlyViewed", () => {
  it("draws nothing before the stored list has been read", async () => {
    show([item("a", "Kaos")], false);
    await render(<RecentlyViewed bleed={16} />);

    expect(screen.queryByText("Terakhir dilihat")).toBeNull();
    expect(screen.queryByText("Kaos")).toBeNull();
  });

  it("draws nothing when the list is empty", async () => {
    show([]);
    await render(<RecentlyViewed bleed={16} />);

    expect(screen.queryByText("Terakhir dilihat")).toBeNull();
    expect(screen.queryByText("Hapus")).toBeNull();
  });

  it("lists the products, newest first, under a header", async () => {
    show([item("b", "Celana"), item("a", "Kaos")]);
    await render(<RecentlyViewed bleed={16} />);

    expect(
      screen.getByRole("header", { name: "Terakhir dilihat" }),
    ).toBeTruthy();
    const names = screen
      .getAllByText(/^(Celana|Kaos)$/)
      .map((n) => n.props.children as string);
    expect(names).toEqual(["Celana", "Kaos"]);
    expect(
      screen.getAllByText(formatRupiah({ amount: 89_000, currency: "IDR" })),
    ).toHaveLength(2);
  });

  it("labels a card with its price, and says 'mulai' for a range", async () => {
    show([
      item("a", "Kaos"),
      item("h", "Hoodie", { priceFrom: 150_000, hasPriceRange: true }),
    ]);
    await render(<RecentlyViewed bleed={16} />);

    const price = (amount: number) => formatRupiah({ amount, currency: "IDR" });
    expect(
      screen.getByRole("button", { name: `Kaos, ${price(89_000)}` }),
    ).toHaveProp("accessibilityHint", "Membuka halaman produk");
    expect(
      screen.getByRole("button", { name: `Hoodie, mulai ${price(150_000)}` }),
    ).toBeTruthy();
  });

  it("opening a card goes to that product's page", async () => {
    show([item("kaos-polos", "Kaos Polos")]);
    await render(<RecentlyViewed bleed={16} />);

    await userEvent.press(screen.getByText("Kaos Polos"));

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/produk/[slug]",
      params: { slug: "kaos-polos" },
    });
  });

  it("draws the stored photo, the placeholder when there is none", async () => {
    show([
      item("a", "Berfoto", {
        image: {
          id: "i",
          url: "https://cdn.goshop.test/a-144.jpg",
          width: 144,
          height: 144,
        },
      }),
      item("b", "Tanpa foto"),
    ]);
    await render(<RecentlyViewed bleed={16} />);

    const sources = screen.container
      .queryAll((n) => n.type === "ExpoImage")
      .map((n) => n.props.source as unknown);
    expect(sources).toHaveLength(1);
    expect(JSON.stringify(sources)).toContain(
      "https://cdn.goshop.test/a-144.jpg",
    );
    expect(screen.getByText("Belum ada foto")).toBeTruthy();
  });

  it("'Hapus' empties the list, hides the section and tells the screen reader", async () => {
    show([item("a", "Kaos")]);
    await render(<RecentlyViewed bleed={16} />);

    await userEvent.press(
      screen.getByRole("button", { name: "Hapus riwayat terakhir dilihat" }),
    );

    expect(useRecentStore.getState().items).toEqual([]);
    expect(screen.queryByText("Terakhir dilihat")).toBeNull();
    expect(announced()).toHaveBeenCalledWith(
      "Riwayat terakhir dilihat dihapus",
    );
  });

  it("appears when the stored list finishes loading", async () => {
    await render(<RecentlyViewed bleed={16} />);
    expect(screen.queryByText("Terakhir dilihat")).toBeNull();

    await act(() => {
      show([item("a", "Kaos")]);
    });

    expect(screen.getByText("Terakhir dilihat")).toBeTruthy();
  });
});
