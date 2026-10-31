// The catalog's search field. It holds what the user types and hands the
// text over only when they submit (the keyboard's search key), the way the
// storefront's search form does: the catalog asks the API once per search,
// not once per keystroke.
import { useTheme } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";

import { Icon } from "@/components/Icon";

// The API's limit on `q`, as in apps/web's catalog filters.
const MAX_QUERY_LENGTH = 100;

interface SearchBarProps {
  /** The search the screen currently shows, to start the field with. */
  initialQuery: string;
  /** Called with the trimmed text when the user submits; "" clears. */
  onSubmit: (query: string) => void;
}

export function SearchBar({ initialQuery, onSubmit }: SearchBarProps) {
  const { colors } = useTheme();
  const [text, setText] = useState(initialQuery);

  return (
    <View style={[styles.field, { borderColor: colors.border }]}>
      <Icon name="cari" color={colors.text} size={18} />
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => {
          onSubmit(text.trim());
        }}
        placeholder="Cari produk"
        placeholderTextColor={PLACEHOLDER_COLOR}
        accessibilityLabel="Cari produk"
        maxLength={MAX_QUERY_LENGTH}
        // The keyboard shows "search" on its action key; submitting also
        // closes it (submitBehavior defaults to blurAndSubmit for one line).
        inputMode="search"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect={false}
        // iOS draws a clear button inside the field; Android has none, so
        // there the user deletes the text, as in other Android apps.
        clearButtonMode="while-editing"
        selectionColor={colors.primary}
        style={[
          styles.input,
          { color: colors.text },
          // Android adds its own vertical padding inside a TextInput.
          Platform.OS === "android" && styles.inputAndroid,
        ]}
      />
    </View>
  );
}

// Readable on the light and the dark theme alike (iOS's secondary label).
const PLACEHOLDER_COLOR = "#8e8e93";

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  inputAndroid: {
    paddingVertical: 6,
  },
});
