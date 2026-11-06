import { Pressable } from "react-native";

import { countRender } from "@/lib/perf";
import { HeartIcon } from "./HeartIcon";
import { useIsWishlisted, useToggleWishlist } from "../hooks/useWishlist";

interface WishlistButtonProps {
  slug: string;
  /** For the screen reader: "Simpan Kaos Polos ke wishlist". */
  productName: string;
  /** Where it sits; the card and the header each place it. */
  className?: string;
}

/**
 * The heart on a product: filled when the product is on the wishlist.
 *
 * - The state comes from the cache, one boolean for this slug
 *   (useIsWishlisted), so a tap elsewhere does not re-render this heart.
 * - Accessibility: a button whose `checked` state is the saved state (the
 *   toggle idiom, announced "dicentang"/"checked" by TalkBack and "selected"
 *   by VoiceOver) and whose label says what a press will do: "Simpan … ke
 *   wishlist" or "Hapus … dari wishlist". The result is announced when
 *   pressed (useToggleWishlist).
 * - Touch target: a 36 dp circle with 6 dp of hitSlop each side is 48 dp,
 *   Android's smallest target.
 * - Signed out it is still there and still pressable: the press answers
 *   "Masuk dulu untuk menyimpan wishlist" (Bab 15 adds the sign-in screen
 *   that message will point to).
 */
export function WishlistButton({
  slug,
  productName,
  className = "",
}: WishlistButtonProps) {
  countRender("WishlistButton");
  const saved = useIsWishlisted(slug);
  const toggle = useToggleWishlist();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        saved
          ? `Hapus ${productName} dari wishlist`
          : `Simpan ${productName} ke wishlist`
      }
      accessibilityState={{ selected: saved, checked: saved }}
      hitSlop={6}
      onPress={() => {
        toggle(slug, saved);
      }}
      className={`h-9 w-9 items-center justify-center rounded-full bg-card/90 active:bg-accent dark:bg-card-dark/90 dark:active:bg-accent-dark ${className}`}
    >
      <HeartIcon saved={saved} />
    </Pressable>
  );
}
