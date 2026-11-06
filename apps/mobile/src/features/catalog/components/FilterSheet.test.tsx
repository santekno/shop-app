import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { onlineManager } from "@tanstack/react-query";
import { act, screen, userEvent } from "@testing-library/react-native";
import { useRef } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccessibilityInfo, BackHandler, Platform, Pressable, Text } from "react-native";

import { apiError, fakeApi, json } from "@/test/fake-api";
import { category } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { DEFAULT_SORT, SORT_OPTIONS } from "../sort-options";
import {
  DEFAULT_CHOICE,
  FilterSheet,
  countActiveFilters,
} from "./FilterSheet";
import type { FilterChoice } from "./FilterSheet";

const [NEWEST, CHEAPEST, PRICIEST] = SORT_OPTIONS;

const Harness = ({
  applied,
  onApply,
}: {
  applied: FilterChoice;
  onApply: (choice: FilterChoice) => void;
}) => {
  const ref = useRef<BottomSheetModal>(null);
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 800 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          ref.current?.present();
        }}
      >
        <Text>Buka</Text>
      </Pressable>
      <FilterSheet sheetRef={ref} applied={applied} onApply={onApply} />
    </SafeAreaProvider>
  );
};

const answerCategories = () => {
  fakeApi.on("GET", "/v1/categories", () => {
    const pakaian = category("pakaian", "Pakaian");
    return json({
      data: [pakaian, category("kaos", "Kaos", pakaian.id), category("sepatu", "Sepatu")],
    });
  });
};

const open = async (
  applied: FilterChoice = DEFAULT_CHOICE,
  onApply: (choice: FilterChoice) => void = jest.fn(),
) => {
  const view = await renderWithProviders(<Harness applied={applied} onApply={onApply} />);
  await userEvent.press(screen.getByRole("button", { name: "Buka" }));
  return { ...view, onApply };
};

afterEach(() => {
  jest.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe("countActiveFilters", () => {
  it("counts the category and the order when they differ from the default", () => {
    expect(countActiveFilters(DEFAULT_CHOICE)).toBe(0);
    expect(countActiveFilters({ category: "kaos", sort: DEFAULT_SORT })).toBe(1);
    expect(countActiveFilters({ category: undefined, sort: CHEAPEST })).toBe(1);
    expect(countActiveFilters({ category: "kaos", sort: PRICIEST })).toBe(2);
  });
});

describe("FilterSheet", () => {
  it("draws nothing until it is presented, then opens on what the route applies", async () => {
    answerCategories();
    await renderWithProviders(
      <Harness applied={{ category: "kaos", sort: CHEAPEST }} onApply={jest.fn()} />,
    );
    expect(screen.queryByText("Filter dan urutan")).toBeNull();

    await userEvent.press(screen.getByRole("button", { name: "Buka" }));

    expect(screen.getByRole("header", { name: "Filter dan urutan" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Harga terendah", checked: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Terbaru", checked: false })).toBeTruthy();
    expect(await screen.findByRole("radio", { name: "Kaos", checked: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Semua kategori", checked: false })).toBeTruthy();
  });

  it("lists the categories as a tree, children after their parent", async () => {
    answerCategories();
    await open();

    await screen.findByRole("radio", { name: "Kaos" });
    const labels = screen
      .getAllByRole("radio")
      .map((r) => r.props.accessibilityLabel as string);
    expect(labels).toEqual([
      "Terbaru",
      "Harga terendah",
      "Harga tertinggi",
      "Semua kategori",
      "Pakaian",
      "Kaos",
      "Sepatu",
    ]);
  });

  it("Terapkan applies the draft and closes the sheet; nothing is applied before", async () => {
    answerCategories();
    const { onApply } = await open();

    await userEvent.press(await screen.findByRole("radio", { name: "Kaos" }));
    await userEvent.press(screen.getByRole("radio", { name: "Harga tertinggi" }));
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.press(screen.getByRole("button", { name: "Terapkan" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ category: "kaos", sort: PRICIEST });
    expect(screen.queryByText("Filter dan urutan")).toBeNull();
  });

  it("Reset sets the draft back to the default and tells VoiceOver", async () => {
    answerCategories();
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear()
      .mockImplementation(() => undefined);
    const { onApply } = await open({ category: "kaos", sort: CHEAPEST });
    await screen.findByRole("radio", { name: "Kaos", checked: true });

    await userEvent.press(screen.getByRole("button", { name: "Reset" }));

    expect(announce).toHaveBeenCalledWith("Filter diatur ulang");
    expect(screen.getByRole("radio", { name: "Terbaru", checked: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Semua kategori", checked: true })).toBeTruthy();
    await userEvent.press(screen.getByRole("button", { name: "Terapkan" }));
    expect(onApply).toHaveBeenCalledWith({ category: undefined, sort: NEWEST });
  });

  it("Reset says nothing on Android, where the live region does the work", async () => {
    answerCategories();
    jest.replaceProperty(Platform, "OS", "android");
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear()
      .mockImplementation(() => undefined);
    await open();

    await userEvent.press(screen.getByRole("button", { name: "Reset" }));

    expect(announce).not.toHaveBeenCalled();
  });

  it("starts from the route again each time it is opened, forgetting an unapplied draft", async () => {
    answerCategories();
    await open();
    await userEvent.press(screen.getByRole("radio", { name: "Harga terendah" }));
    // The scrim closes it without applying.
    await userEvent.press(screen.getByRole("button", { name: "Tutup filter" }));
    expect(screen.queryByText("Filter dan urutan")).toBeNull();

    await userEvent.press(screen.getByRole("button", { name: "Buka" }));

    expect(screen.getByRole("radio", { name: "Terbaru", checked: true })).toBeTruthy();
  });

  it("the scrim is a button named 'Tutup filter' that closes the sheet", async () => {
    answerCategories();
    const { onApply } = await open();

    await userEvent.press(screen.getByRole("button", { name: "Tutup filter" }));

    expect(screen.queryByText("Filter dan urutan")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  describe("Android back button", () => {
    const backPress = () => {
      const spy = jest.spyOn(BackHandler, "addEventListener");
      return spy;
    };

    it("closes the sheet while it is open, and says the press was handled", async () => {
      answerCategories();
      const add = backPress();
      await open();

      const call = add.mock.calls.find(([name]) => name === "hardwareBackPress");
      expect(call).toBeDefined();
      let handled: unknown;
      await act(() => {
        handled = call?.[1]();
      });

      expect(handled).toBe(true);
      expect(screen.queryByText("Filter dan urutan")).toBeNull();
    });

    it("is not listened to while the sheet is closed, and stops after it closes", async () => {
      answerCategories();
      const remove = jest.fn();
      const add = jest
        .spyOn(BackHandler, "addEventListener")
        .mockReturnValue({ remove });
      await renderWithProviders(<Harness applied={DEFAULT_CHOICE} onApply={jest.fn()} />);
      expect(add).not.toHaveBeenCalled();

      await userEvent.press(screen.getByRole("button", { name: "Buka" }));
      expect(add).toHaveBeenCalledTimes(1);
      await userEvent.press(screen.getByRole("button", { name: "Tutup filter" }));

      expect(remove).toHaveBeenCalledTimes(1);
    });
  });

  describe("the category list", () => {
    it("loading: the order stays usable and 'Memuat kategori…' shows", async () => {
      fakeApi.on("GET", "/v1/categories", () => new Promise<Response>(() => undefined));
      await open();

      expect(screen.getByRole("progressbar", { name: "Memuat kategori…" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Semua kategori", checked: true })).toBeTruthy();
      // The pending request is released by the next test's reset; do not fail the held check.
    });

    it("offline: waits for the connection", async () => {
      onlineManager.setOnline(false);
      answerCategories();
      await open();

      expect(
        screen.getByText(
          "Tidak ada koneksi internet. Kategori dimuat begitu koneksi kembali.",
        ),
      ).toBeTruthy();
    });

    it("failed: shows the error, and Coba lagi loads the categories", async () => {
      fakeApi.once("GET", "/v1/categories", () => apiError(500, "INTERNAL", "r-8"));
      answerCategories();
      await open();

      await userEvent.press(await screen.findByRole("button", { name: "Coba lagi" }));

      expect(await screen.findByRole("radio", { name: "Sepatu" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Harga terendah" })).toBeTruthy();
    });
  });
});
