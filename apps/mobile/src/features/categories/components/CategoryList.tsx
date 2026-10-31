import { useTheme } from "expo-router";
import { memo } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import type { CategoryRow } from "../hooks/useCategoryRows";

/** Indentation per level of the tree, in dp, on top of the row's own 16. */
const INDENT = 16;

interface CategoryListProps {
  rows: readonly CategoryRow[];
  /** Called with the slug of the category the buyer tapped. */
  onPressCategory: (slug: string) => void;
  /** True while a pull-to-refresh the buyer started is running. */
  refreshing: boolean;
  onRefresh: () => void;
  /** Set when a refresh failed: the old list stays, with a note above it. */
  refreshFailed: boolean;
}

/**
 * Every category, top-level ones first in each group, their sub-categories
 * indented under them. Every row opens the catalog filtered by its
 * category; a parent's filter includes its sub-categories' products (the
 * API's rule, as on the website), so a parent is a link too, not only a
 * heading.
 *
 * A FlatList rather than a ScrollView for its pull-to-refresh and its
 * empty state; the list is short (the API does not even paginate it), so
 * rendering only what is on screen matters less here than in the catalog.
 */
export function CategoryList({
  rows,
  onPressCategory,
  refreshing,
  onRefresh,
  refreshFailed,
}: CategoryListProps) {
  const { colors } = useTheme();

  // React Native 0.88's types take a header element or undefined, not null.
  const refreshFailedNote = refreshFailed ? (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="m-4 rounded-lg border border-destructive p-3 dark:border-destructive-dark"
    >
      <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
        Gagal memperbarui kategori. Daftar di bawah mungkin belum yang terbaru.
      </Text>
    </View>
  ) : undefined;

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.node.id}
      renderItem={({ item }) => (
        <CategoryRowItem row={item} onPress={onPressCategory} />
      )}
      // flexGrow lets the empty state centre itself in the whole screen.
      contentContainerClassName="grow pb-4"
      className="bg-background dark:bg-background-dark"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          // The spinner's colour: tintColor on iOS, colors on Android.
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={refreshFailedNote}
      ListEmptyComponent={
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Icon
            name="kategori"
            className="text-muted-foreground dark:text-muted-foreground-dark"
            size={40}
          />
          <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
            Belum ada kategori.
          </Text>
        </View>
      }
    />
  );
}

interface CategoryRowItemProps {
  row: CategoryRow;
  onPress: (slug: string) => void;
}

/**
 * One category. Top-level rows carry the category icon and a bold name;
 * deeper rows are indented by their depth. Every row ends in a chevron,
 * the platform's sign for "opens another screen". The indentation is a
 * number computed from the data, which no class can express, so it is the
 * one inline style (the same reason the safe-area insets are styles).
 */
const CategoryRowItem = memo(function CategoryRowItem({
  row,
  onPress,
}: CategoryRowItemProps) {
  const { node, depth } = row;
  const isTop = depth === 0;
  const hasChildren = node.children.length > 0;

  return (
    <Pressable
      onPress={() => {
        onPress(node.slug);
      }}
      // One element for TalkBack and VoiceOver: the name, then "button",
      // then what tapping it does.
      accessibilityRole="button"
      accessibilityLabel={node.name}
      accessibilityHint={
        hasChildren
          ? "Membuka katalog kategori ini, termasuk subkategorinya"
          : "Membuka katalog kategori ini"
      }
      style={{ paddingLeft: 16 + depth * INDENT }}
      // min-h-12 is 48 dp, the smallest comfortable touch target.
      // border-b-hairline is the thinnest line the screen can draw.
      className={`min-h-12 flex-row items-center gap-3 border-b-hairline border-border bg-card py-3 pr-4 active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark ${isTop ? "mt-4" : ""}`}
    >
      {isTop && (
        <Icon
          name="kategori"
          className="text-primary dark:text-primary-dark"
          size={20}
        />
      )}
      <Text
        className={`flex-1 font-sans text-base text-foreground dark:text-foreground-dark ${isTop ? "font-semibold" : ""}`}
      >
        {node.name}
      </Text>
      <Icon
        name="lanjut"
        className="text-muted-foreground dark:text-muted-foreground-dark"
        size={20}
      />
    </Pressable>
  );
});
