import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Product, ProductVariant } from "@goshop/shared";

import { WishlistButton } from "@/features/wishlist/components/WishlistButton";
import { announceOnIos } from "@/lib/announce";
import { priceLabel, selectedVariant, stockLabel } from "../variants";
import { ProductGallery } from "./ProductGallery";
import { VariantPicker } from "./VariantPicker";

interface ProductDetailViewProps {
  product: Product;
}

/**
 * A loaded product: gallery, name, the chosen variant's price and stock,
 * the variant picker and the description.
 *
 * The only state is the id the buyer tapped. The variant on screen is
 * derived from it on every render (selectedVariant), so a refetch that
 * sells a variant out moves the selection to one that can be bought
 * instead of leaving a dead choice behind.
 *
 * The price and stock block is a polite live region on Android; on iOS the
 * new price is handed to VoiceOver when a variant is chosen, since iOS has
 * no live regions.
 */
export function ProductDetailView({ product }: ProductDetailViewProps) {
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const variant = selectedVariant(product, chosenId);
  const price = priceLabel(product, variant);
  const stock = stockLabel(variant);

  const choose = (next: ProductVariant) => {
    setChosenId(next.id);
    announceOnIos(
      `${next.name}, ${priceLabel(product, next)}, ${stockLabel(next)}`,
    );
  };

  return (
    <ScrollView
      className="bg-background dark:bg-background-dark"
      contentContainerClassName="pb-8"
    >
      <ProductGallery
        key={product.id}
        images={product.images}
        productName={product.name}
      />
      <View className="gap-4 px-4 pt-2">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text
              accessibilityRole="header"
              className="font-sans text-2xl font-bold text-foreground dark:text-foreground-dark"
            >
              {product.name}
            </Text>
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {product.category.name}
            </Text>
          </View>
          <WishlistButton
            slug={product.slug}
            productName={product.name}
            className="border border-border dark:border-border-dark"
          />
        </View>
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${price}, ${stock}`}
          className="gap-0.5"
        >
          <Text className="font-sans text-2xl font-bold text-foreground dark:text-foreground-dark">
            {price}
          </Text>
          <Text
            className={`font-sans text-sm font-semibold ${
              variant === undefined
                ? "text-destructive dark:text-destructive-dark"
                : "text-muted-foreground dark:text-muted-foreground-dark"
            }`}
          >
            {stock}
          </Text>
        </View>
        <VariantPicker
          variants={product.variants}
          selectedId={variant?.id}
          onSelect={choose}
        />
        {product.description !== "" && (
          <View className="gap-1">
            <Text
              accessibilityRole="header"
              className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark"
            >
              Deskripsi
            </Text>
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              {product.description}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
