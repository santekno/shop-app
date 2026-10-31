// The catalog's search field. It holds what the user types and hands the
// text over only when they submit (the keyboard's search key), the way the
// storefront's search form does: the catalog asks the API once per search,
// not once per keystroke.
import { useTheme } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";

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
  // Colours that are props rather than styles (the icon's, the text
  // cursor's) come from the navigation theme: the same roles as the
  // classes (src/theme/navigation.ts).
  const { colors } = useTheme();
  const [text, setText] = useState(initialQuery);

  return (
    <View className="min-h-11 flex-row items-center gap-2 rounded-[10px] border-hairline border-border px-3 dark:border-border-dark">
      <Icon name="cari" color={colors.text} size={18} />
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => {
          onSubmit(text.trim());
        }}
        placeholder="Cari produk"
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
        // placeholder: is NativeWind's variant for the placeholder's colour:
        // it moves the class's `color` to the placeholderTextColor prop.
        // Android adds its own vertical padding inside a TextInput, hence
        // the smaller android: padding. text-[16px] rather than text-base,
        // which also sets a line height: in a TextInput that shifts the
        // text off centre on iOS.
        className="flex-1 py-2.5 text-[16px] text-foreground placeholder:text-muted-foreground android:py-1.5 dark:text-foreground-dark dark:placeholder:text-muted-foreground-dark"
      />
    </View>
  );
}
