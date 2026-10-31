// The sort sheet, at /filter, presented as a modal by the root stack
// (app/_layout.tsx): it slides up over whatever is showing, tab bar
// included, and is closed rather than "gone back" from. Beranda opens it
// with the current order (/filter?urut=…); picking one returns to Beranda
// with the new order as its route parameter, which the catalog reads.
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { SORT_OPTIONS, sortFromParam } from "@/features/catalog/sort-options";

export default function FilterScreen() {
  const { urut } = useLocalSearchParams<{ urut?: string }>();
  const current = sortFromParam(urut);

  return (
    <View style={styles.container}>
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
                    <Text style={styles.close}>Tutup</Text>
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
                  params: { urut: option.param },
                });
              }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.label}>{option.label}</Text>
              {selected ? (
                <Icon name="terpilih" color="#2563eb" filled />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 16,
  },
  close: {
    fontSize: 16,
    color: "#2563eb",
  },
});
