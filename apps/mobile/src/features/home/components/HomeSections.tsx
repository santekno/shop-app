import { View } from "react-native";

import { BannerCarousel } from "./BannerCarousel";
import { CategoryChips } from "./CategoryChips";
import { FeaturedProducts } from "./FeaturedProducts";

interface HomeSectionsProps {
  /** Opens the catalog narrowed to this category slug. */
  onOpenCategory: (slug: string) => void;
  /** The side padding of the list these sections sit in (see BannerCarousel). */
  bleed: number;
}

/**
 * What Beranda shows above the full catalog when nothing narrows it: the
 * banner carousel, the category row and the featured products. Three
 * independent queries, three independent states.
 */
export function HomeSections({ onOpenCategory, bleed }: HomeSectionsProps) {
  return (
    <View className="gap-1 pt-4">
      <BannerCarousel onOpenCategory={onOpenCategory} bleed={bleed} />
      <CategoryChips onOpenCategory={onOpenCategory} bleed={bleed} />
      <FeaturedProducts bleed={bleed} />
    </View>
  );
}
