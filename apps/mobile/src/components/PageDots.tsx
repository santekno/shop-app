import { View } from "react-native";

interface PageDotsProps {
  /** How many pages there are. One or none draws nothing. */
  count: number;
  /** The page on screen, from 0. */
  index: number;
}

/**
 * The row of dots under a paged list (the banner carousel, the product
 * gallery): the current page is the long, solid one. Decorative: a screen
 * reader gets the position from the page itself ("Banner 2 dari 3"), so
 * the dots are hidden from it, like Icon.
 */
export function PageDots({ count, index }: PageDotsProps) {
  if (count <= 1) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center justify-center gap-1.5 py-2"
    >
      {Array.from({ length: count }, (_, page) => (
        <View
          key={page}
          className={
            page === index
              ? "h-2 w-5 rounded-full bg-primary dark:bg-primary-dark"
              : "h-2 w-2 rounded-full bg-border dark:bg-border-dark"
          }
        />
      ))}
    </View>
  );
}
