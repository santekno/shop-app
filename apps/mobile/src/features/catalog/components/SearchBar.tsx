// The catalog's search field. It holds what the user types and tells the
// screen to search once they pause (useDebouncedValue), or at once on the
// keyboard's search key and the clear button. The catalog therefore asks
// the API once per pause, not once per keystroke, and the request for a
// search the user has already typed past is never sent.
import { useTheme } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import type { TextInputInstance } from "react-native";

import { Icon } from "@/components/Icon";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

// The API's limit on `q`, as in apps/web's catalog filters.
const MAX_QUERY_LENGTH = 100;

/** How long the field must be still before the search starts. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The fewest characters a typed search needs before it is sent. One letter
 * matches half the catalog and costs a request; the user is still typing.
 * Clearing the field (zero characters) is a search too: it removes the
 * filter. The keyboard's search key sends whatever is there.
 */
export const MIN_SEARCH_LENGTH = 2;

/** The text as the API sees it: trimmed, so "kaos " and "kaos" are one search. */
const normalise = (text: string) => text.trim();

/** Characters as a person counts them: "😀" is one, not two. */
const lengthOf = (text: string) => Array.from(text).length;

interface SearchBarProps {
  /** The search the screen currently shows, to start the field with. */
  initialQuery: string;
  /**
   * Called with the trimmed text when the search should change: the user
   * paused, pressed the keyboard's search key or cleared the field. "" means
   * no search. Never called with the search the screen already shows.
   */
  onSubmit: (query: string) => void;
}

export function SearchBar({ initialQuery, onSubmit }: SearchBarProps) {
  // The text cursor's colour is a prop NativeWind does not map from a
  // class, so it comes from the navigation theme: the same roles as the
  // classes (src/theme/navigation.ts). The icon takes a class.
  const { colors } = useTheme();
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState(initialQuery);
  const settled = normalise(useDebouncedValue(text, SEARCH_DEBOUNCE_MS));

  // The route's search changed. Our own search comes back here too, equal
  // to `settled`, and must not touch what the user is still typing; any
  // other change (a deep link, "Reset filter" in the empty state) starts
  // the field again from it. Adjusting state while rendering, instead of in
  // an effect, avoids drawing the old text for one frame.
  const [seen, setSeen] = useState(initialQuery);
  if (initialQuery !== seen) {
    setSeen(initialQuery);
    if (initialQuery !== settled) {
      setText(initialQuery);
    }
  }

  // An effect event reads the latest props without being a dependency:
  // the effect below must run when `settled` changes, not when the route
  // does (that would send the old `settled` again after a reset).
  const search = (query: string) => {
    if (query !== initialQuery) {
      onSubmit(query);
    }
  };
  const searchSettled = useEffectEvent(search);
  useEffect(() => {
    if (settled === "" || lengthOf(settled) >= MIN_SEARCH_LENGTH) {
      searchSettled(settled);
    }
  }, [settled]);

  return (
    <View className="min-h-11 flex-row items-center gap-2 rounded-[10px] border-hairline border-border px-3 dark:border-border-dark">
      <Icon
        name="cari"
        className="text-foreground dark:text-foreground-dark"
        size={18}
      />
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => {
          search(normalise(text));
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
        selectionColor={colors.primary}
        // placeholder: is NativeWind's variant for the placeholder's colour:
        // it moves the class's `color` to the placeholderTextColor prop.
        // Android adds its own vertical padding inside a TextInput, hence
        // the smaller android: padding. text-[16px] rather than text-base,
        // which also sets a line height: in a TextInput that shifts the
        // text off centre on iOS.
        className="flex-1 py-2.5 font-sans text-[16px] text-foreground placeholder:text-muted-foreground android:py-1.5 dark:text-foreground-dark dark:placeholder:text-muted-foreground-dark"
      />
      {/* Our own clear button on both platforms (iOS's built-in one looks
          different and Android has none). Only when there is text. It
          searches at once, without waiting for the pause, and keeps the
          keyboard up for the next search. */}
      {text !== "" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hapus pencarian"
          // The icon is 18 dp; 18 + 2 × 15 = 48 dp, Android's smallest
          // touch target.
          hitSlop={15}
          onPress={() => {
            setText("");
            search("");
            input.current?.focus();
          }}
        >
          <Icon
            name="tutup"
            className="text-muted-foreground dark:text-muted-foreground-dark"
            size={18}
          />
        </Pressable>
      )}
    </View>
  );
}
