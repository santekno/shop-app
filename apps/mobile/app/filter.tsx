// The sort sheet, at /filter, presented as a modal by the root stack
// (app/_layout.tsx): it slides up over whatever is showing, tab bar
// included, and is closed rather than "gone back" from. Beranda opens it
// with the current order (/filter?urut=…); picking one returns to Beranda
// with the new order as its route parameter, which the catalog reads.
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { SORT_OPTIONS, sortFromParam } from "@/features/catalog/sort-options";

export default function FilterScreen() {
  // The header covers the top edge; nothing covers the bottom one, where
  // the home indicator (iOS) or the navigation bar (Android, drawn over
  // the app edge to edge) sits. The last row must stay above it.
  const insets = useSafeAreaInsets();
  // The catalog's other filters ride along, so picking an order keeps the
  // category and the search (Beranda passes them in, artikel 06).
  const { kategori, q, urut } = useLocalSearchParams<{
    kategori?: string;
    q?: string;
    urut?: string;
  }>();
  const current = sortFromParam(urut);

  return (
    <ScrollView
      // The fixed padding as classes; the bottom one is a number measured
      // on this device, which no class can be, so it stays a style. The
      // two are merged.
      contentContainerClassName="px-4 pt-2"
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
    >
      {/* iOS shows a modal as a card with no back button: the user swipes
          it down or taps a close button in its header. Android shows it
          full screen with the usual back arrow and the system back
          gesture, so a second "close" would be noise there. */}
      <Stack.Screen
        options={{
          headerRight:
            Platform.OS === "ios"
              ? () => (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => {
                      router.back();
                    }}
                  >
                    <Text className="font-sans text-base text-primary dark:text-primary-dark">
                      Tutup
                    </Text>
                  </Pressable>
                )
              : undefined,
        }}
      />
      <View accessibilityRole="radiogroup">
        {SORT_OPTIONS.map((option) => {
          const selected = option.value === current.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                // Back to Beranda, which already sits under this modal,
                // with the new order. dismissTo pops to that screen instead
                // of pushing a second Beranda on top.
                router.dismissTo({
                  pathname: "/",
                  params: { kategori, q, urut: option.param },
                });
              }}
              // border-b-hairline is StyleSheet.hairlineWidth (the thinnest
              // line the screen can draw), from tailwind.config.js.
              // active: is the pressed state.
              className="min-h-12 flex-row items-center justify-between border-b-hairline border-border py-3 active:opacity-60 dark:border-border-dark"
            >
              <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                {option.label}
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
        })}
      </View>
    </ScrollView>
  );
}
