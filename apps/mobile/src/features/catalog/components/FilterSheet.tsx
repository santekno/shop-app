// The filter sheet: Beranda's sort order and category in a bottom sheet
// that rises over the catalog, replacing the /filter modal route of
// artikel 13. A route needed a navigation round trip and gave the list a
// full screen of its own; a sheet leaves the catalog visible behind its
// scrim, closes with a tap outside, a swipe down or the Android back
// button, and costs no screen in the stack.
//
// The state is still the route (?kategori=…&urut=…): the sheet edits a
// draft and "Terapkan" writes it to the route, which the catalog reads.
// Nothing changes in the list while the buyer is still choosing.
//
// The API's GET /v1/products has no price parameters (api/openapi.yaml:
// category, q, sort, featured, cursor, limit), so there is no price range
// here: a field the server ignores would only pretend to filter.
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { BottomSheetHandle } from "@gorhom/bottom-sheet";
import type {
  BottomSheetBackdropProps,
  BottomSheetHandleProps,
} from "@gorhom/bottom-sheet";
import { useTheme } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Pressable,
  Text,
  View,
} from "react-native";
import type { ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { ErrorState, LoadingState } from "@/components/StatusMessage";
import { EmptyState } from "@/components/StatusMessage";
import { announceOnIos } from "@/lib/announce";
import { queryView } from "@/lib/query-state";
import { useCategoryRows } from "@/features/categories/hooks/useCategoryRows";
import { DEFAULT_SORT, SORT_OPTIONS } from "../sort-options";
import type { SortOption } from "../sort-options";

/** What the sheet edits: the route's category and order. */
export interface FilterChoice {
  /** A category slug, or undefined for every category. */
  category: string | undefined;
  sort: SortOption;
}

/** No category, newest first: what "Reset" goes back to. */
export const DEFAULT_CHOICE: FilterChoice = {
  category: undefined,
  sort: DEFAULT_SORT,
};

/** How many of the sheet's filters differ from the default (0, 1 or 2). */
export const countActiveFilters = (choice: FilterChoice): number =>
  (choice.category === undefined ? 0 : 1) +
  (choice.sort.value === DEFAULT_SORT.value ? 0 : 1);

/** Two heights: most of the options at once, or all of them. */
const SNAP_POINTS = ["60%", "90%"];

/** A row of the sheet's lists: one option, a radio button. */
const OPTION_ROW =
  "min-h-12 flex-row items-center justify-between border-b-hairline border-border active:opacity-60 dark:border-border-dark";

interface FilterSheetProps {
  /** Held by the screen, which opens the sheet with `ref.current?.present()`. */
  sheetRef: RefObject<BottomSheetModal | null>;
  /** What the route applies now: the sheet opens on it. */
  applied: FilterChoice;
  /** The buyer pressed "Terapkan" with this choice. */
  onApply: (choice: FilterChoice) => void;
}

export function FilterSheet({ sheetRef, applied, onApply }: FilterSheetProps) {
  const { colors } = useTheme();
  const titleRef = useRef<ViewInstance>(null);
  const [open, setOpen] = useState(false);

  // Android's back button closes the sheet first, as it closes a dialog,
  // instead of leaving the screen behind it. Registered only while open;
  // returning true says the press was handled.
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        sheetRef.current?.dismiss();
        return true;
      },
    );
    return () => {
      subscription.remove();
    };
  }, [open, sheetRef]);

  // The scrim: a tap closes (pressBehavior "close"). It is a button for
  // TalkBack and VoiceOver as well, with words in the app's language.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        accessibilityLabel="Tutup filter"
        accessibilityHint="Ketuk dua kali untuk menutup lembar filter"
      />
    ),
    [],
  );

  const renderHandle = useCallback(
    (props: BottomSheetHandleProps) => (
      <BottomSheetHandle
        {...props}
        indicatorStyle={{ backgroundColor: colors.border }}
        accessibilityLabel="Pegangan lembar filter"
        accessibilityHint="Geser ke atas atau ke bawah untuk mengubah tinggi lembar filter"
      />
    ),
    [colors.border],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.card }}
      handleComponent={renderHandle}
      // On iOS, VoiceOver stays inside the sheet and ignores what is
      // behind the scrim.
      accessibilityViewIsModal
      onChange={(index) => {
        setOpen(index >= 0);
        // The sheet has settled: the screen reader goes to its title,
        // otherwise it would stay on the button behind the scrim.
        if (index >= 0 && titleRef.current !== null) {
          AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
        }
      }}
      onDismiss={() => {
        setOpen(false);
      }}
    >
      {/* Mounted only while the sheet is presented, so its draft starts
          from what the route applies each time it opens. */}
      <FilterSheetBody
        titleRef={titleRef}
        applied={applied}
        onApply={(choice) => {
          onApply(choice);
          sheetRef.current?.dismiss();
        }}
      />
    </BottomSheetModal>
  );
}

interface FilterSheetBodyProps {
  titleRef: RefObject<ViewInstance | null>;
  applied: FilterChoice;
  onApply: (choice: FilterChoice) => void;
}

function FilterSheetBody({ titleRef, applied, onApply }: FilterSheetBodyProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<FilterChoice>(applied);
  const categories = useCategoryRows();
  const categoriesView = queryView(categories);

  return (
    <View className="flex-1">
      <View
        ref={titleRef}
        accessible
        accessibilityRole="header"
        className="px-4 pb-2 pt-1"
      >
        <Text className="font-sans text-lg font-bold text-foreground dark:text-foreground-dark">
          Filter dan urutan
        </Text>
      </View>
      <BottomSheetScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
      >
        <Text className="pb-1 pt-2 font-sans text-sm font-semibold text-muted-foreground dark:text-muted-foreground-dark">
          Urutkan
        </Text>
        <View accessibilityRole="radiogroup">
          {SORT_OPTIONS.map((option) => (
            <OptionRow
              key={option.value}
              label={option.label}
              selected={option.value === draft.sort.value}
              onPress={() => {
                setDraft({ ...draft, sort: option });
              }}
            />
          ))}
        </View>

        <Text className="pb-1 pt-5 font-sans text-sm font-semibold text-muted-foreground dark:text-muted-foreground-dark">
          Kategori
        </Text>
        <View accessibilityRole="radiogroup">
          <OptionRow
            label="Semua kategori"
            selected={draft.category === undefined}
            onPress={() => {
              setDraft({ ...draft, category: undefined });
            }}
          />
          {categoriesView === "ready" &&
            categories.data?.map(({ node, depth }) => (
              <OptionRow
                key={node.id}
                label={node.name}
                depth={depth}
                selected={draft.category === node.slug}
                onPress={() => {
                  setDraft({ ...draft, category: node.slug });
                }}
              />
            ))}
        </View>
        {/* The categories can fail without taking the sort with them. */}
        {categoriesView === "loading" && (
          <LoadingState label="Memuat kategori…" />
        )}
        {categoriesView === "offline" && (
          <EmptyState message="Tidak ada koneksi internet. Kategori dimuat begitu koneksi kembali." />
        )}
        {categoriesView === "error" && (
          <ErrorState
            error={categories.error}
            onRetry={() => {
              void categories.refetch();
            }}
          />
        )}
      </BottomSheetScrollView>
      {/* Outside the scroll: "Terapkan" is always in reach, above the home
          indicator (iOS) or the navigation bar (Android, edge to edge). */}
      <View
        style={{ paddingBottom: insets.bottom + 12 }}
        className="flex-row gap-3 border-t-hairline border-border px-4 pt-3 dark:border-border-dark"
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDraft(DEFAULT_CHOICE);
            announceOnIos("Filter diatur ulang");
          }}
          className="min-h-12 flex-1 items-center justify-center rounded-md border border-border active:bg-accent dark:border-border-dark dark:active:bg-accent-dark"
        >
          <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
            Reset
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onApply(draft);
          }}
          className="min-h-12 flex-[2] items-center justify-center rounded-md bg-primary active:opacity-80 dark:bg-primary-dark"
        >
          <Text className="font-sans text-base font-semibold text-primary-foreground dark:text-primary-foreground-dark">
            Terapkan
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

interface OptionRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** How deep in the category tree: indents the label 16 dp per level. */
  depth?: number;
}

function OptionRow({ label, selected, onPress, depth = 0 }: OptionRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ paddingLeft: depth * 16 }}
      className={OPTION_ROW}
    >
      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {selected ? (
        <Icon
          name="terpilih"
          className="text-primary dark:text-primary-dark"
          filled
        />
      ) : null}
    </Pressable>
  );
}
