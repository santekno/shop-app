import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, userEvent } from "@testing-library/react-native";
import type { CategoryNode } from "@goshop/shared";
import { AccessibilityInfo } from "react-native";

import { category } from "@/test/fixtures";
import { isRefreshingShown, refreshControl } from "@/test/list";
import { renderWithProviders } from "@/test/render";
import { flattenCategoryTree } from "../hooks/useCategoryRows";
import { CategoryList } from "./CategoryList";

const node = (
  slug: string,
  name: string,
  children: CategoryNode[] = [],
): CategoryNode => ({
  ...category(slug, name, null, `id-${slug}`),
  children,
});

const ROWS = flattenCategoryTree([
  node("pakaian", "Pakaian", [
    node("kaos", "Kaos", [node("kaos-polos", "Kaos Polos")]),
  ]),
  node("topi", "Topi"),
]);

const REFRESH_FAILED =
  "Gagal memperbarui kategori. Daftar di bawah mungkin belum yang terbaru.";

afterEach(() => {
  jest.restoreAllMocks();
});

const renderList = (props: Partial<Parameters<typeof CategoryList>[0]> = {}) =>
  renderWithProviders(
    <CategoryList
      rows={ROWS}
      onPressCategory={() => undefined}
      refreshing={false}
      onRefresh={() => undefined}
      refreshFailed={false}
      {...props}
    />,
  );

const row = (name: string) => screen.getByRole("button", { name });

/** The icons a row draws (the category mark, the chevron). */
const iconCount = (name: string) =>
  row(name).queryAll((i) => i.type === "RNSVGSvgView").length;

describe("CategoryList", () => {
  it("says there are no categories when the list is empty", async () => {
    await renderList({ rows: [] });
    expect(screen.getByText("Belum ada kategori.")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).not.toBeOnTheScreen();
  });

  it("shows every category in tree order", async () => {
    await renderList();
    expect(
      screen
        .getAllByRole("button")
        .map((b) => b.props.accessibilityLabel as unknown),
    ).toEqual(["Pakaian", "Kaos", "Kaos Polos", "Topi"]);
  });

  it("indents each level by 16 dp on top of the row's own 16", async () => {
    await renderList();
    expect(row("Pakaian")).toHaveStyle({ paddingLeft: 16 });
    expect(row("Kaos")).toHaveStyle({ paddingLeft: 32 });
    expect(row("Kaos Polos")).toHaveStyle({ paddingLeft: 48 });
    expect(row("Topi")).toHaveStyle({ paddingLeft: 16 });
  });

  it("gives top-level rows the category icon; every row has the chevron", async () => {
    await renderList();
    expect(iconCount("Pakaian")).toBe(2);
    expect(iconCount("Topi")).toBe(2);
    expect(iconCount("Kaos")).toBe(1);
    expect(iconCount("Kaos Polos")).toBe(1);
  });

  it("tells a screen reader whether a row includes sub-categories", async () => {
    await renderList();
    const parent = "Membuka katalog kategori ini, termasuk subkategorinya";
    const leaf = "Membuka katalog kategori ini";
    expect(row("Pakaian")).toHaveProp("accessibilityHint", parent);
    expect(row("Kaos")).toHaveProp("accessibilityHint", parent);
    expect(row("Kaos Polos")).toHaveProp("accessibilityHint", leaf);
    expect(row("Topi")).toHaveProp("accessibilityHint", leaf);
  });

  it("hands the tapped row's slug over, a parent's too", async () => {
    const onPressCategory = jest.fn();
    await renderList({ onPressCategory });

    await userEvent.press(row("Kaos Polos"));
    await userEvent.press(row("Pakaian"));

    expect(onPressCategory.mock.calls).toEqual([["kaos-polos"], ["pakaian"]]);
  });

  it("notes a failed refresh above the old list, read out on both platforms", async () => {
    // React Native's Jest setup already mocks it; clear earlier calls.
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await renderList({ refreshFailed: true });

    const note = screen.getByText(REFRESH_FAILED);
    expect(note.parent).toHaveProp("accessibilityRole", "alert");
    // TalkBack: the live region. VoiceOver (jest-expo runs as iOS): the
    // announcement, once.
    expect(note.parent).toHaveProp("accessibilityLiveRegion", "polite");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(REFRESH_FAILED);
    expect(row("Pakaian")).toBeOnTheScreen();
  });

  it("has no note, and announces nothing, while the list is current", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await renderList();
    expect(
      screen.queryByText(/Gagal memperbarui kategori/),
    ).not.toBeOnTheScreen();
    expect(announce).not.toHaveBeenCalled();
  });

  it("shows the refresh spinner only while told, and pulls through onRefresh", async () => {
    const onRefresh = jest.fn();
    await renderList({ onRefresh });
    expect(isRefreshingShown()).toBe(false);

    await fireEvent(refreshControl(), "refresh");
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await screen.rerender(
      <CategoryList
        rows={ROWS}
        onPressCategory={() => undefined}
        refreshing
        onRefresh={onRefresh}
        refreshFailed={false}
      />,
    );
    expect(isRefreshingShown()).toBe(true);
  });
});
