// The Kategori tab, at /kategori: every category from GET /v1/categories
// as a tree, each one a way into the catalog filtered by it.
//
// Scaffolded by an AI assistant, then adapted to this app's patterns:
// the prompt, the raw output and every change with its reason are in
// docs/ai-scaffold-kategori.md (artikel 14).
//
// The route stays thin: the data comes from a hook, the rows and the
// states from components in src/features/categories.
//
// useQuery needs the QueryClientProvider at the root (app/_layout.tsx),
// which arrives with the catalog's product list (artikel 06).
import { useNavigation } from "expo-router";
import type { BottomTabNavigationProp } from "expo-router/js-tabs";
import { useState } from "react";

import { CategoryList } from "@/features/categories/components/CategoryList";
import {
  CategoryError,
  CategoryLoading,
} from "@/features/categories/components/CategoryStatus";
import { useCategoryRows } from "@/features/categories/hooks/useCategoryRows";

/**
 * The tabs of app/(tabs)/_layout.tsx with the parameters this screen
 * sends, for useNavigation's type: a screen name that is not a tab, or a
 * wrong parameter, fails tsc. A `type`, not an interface: React
 * Navigation's ParamListBase needs the index signature only a type alias
 * gets implicitly.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type TabParams = {
  index: { kategori?: string; q?: string; urut?: string } | undefined;
  kategori: undefined;
  keranjang: undefined;
  akun: undefined;
};

export default function CategoriesScreen() {
  // `status` is about the data ("pending": none yet, "error", "success");
  // `isFetching` is about the network, also true while old data is shown.
  const { data: rows, status, error, isFetching, refetch } = useCategoryRows();
  const navigation = useNavigation<BottomTabNavigationProp<TabParams>>();

  // The catalog is Beranda ("/"), filtered by ?kategori=<slug>, the word
  // the storefront puts in its URL (/?kategori=kaos), so
  // goshop://?kategori=kaos and the website's link mean the same thing.
  // Beranda is the sibling tab "index": navigate switches to it instead of
  // stacking a second one, and `merge` keeps the search and the sort the
  // buyer already has there, as the storefront's category links do
  // (apps/web CategorySection). router.navigate({ pathname: "/", params })
  // would replace Beranda's params and drop them (found in the chapter's
  // native check).
  const openCategory = (slug: string) => {
    navigation.navigate("index", { kategori: slug }, { merge: true });
  };
  // Only a pull the buyer started shows the refresh spinner, not every
  // background refetch TanStack Query decides to run.
  const [pulling, setPulling] = useState(false);

  const refresh = () => {
    setPulling(true);
    void refetch().finally(() => {
      setPulling(false);
    });
  };

  // A list once loaded stays on screen, even when a later refresh fails.
  if (rows !== undefined) {
    return (
      <CategoryList
        rows={rows}
        onPressCategory={openCategory}
        refreshing={pulling}
        onRefresh={refresh}
        refreshFailed={status === "error" && !isFetching}
      />
    );
  }

  // The first load, or a retry after an error.
  if (status === "pending" || isFetching) {
    return <CategoryLoading />;
  }

  return (
    <CategoryError
      error={error}
      onRetry={() => {
        void refetch();
      }}
    />
  );
}
