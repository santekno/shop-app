import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adjustVariantStock } from "@goshop/shared";
import type { AdminProduct } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { productKeys } from "../api/queries.ts";
import {
  savedStockChange,
  stockChangeErrorResult,
  toStockAdjustment,
} from "../stock.ts";
import type { StockChange, StockChangeResult } from "../stock.ts";

/**
 * Changes one variant's stock without the product form (Bab 12 artikel
 * 05): one POST …/variants/{variant_id}/stock-adjustments, nothing read
 * first, nothing else of the product sent.
 *
 * The API does the work in one guarded statement: a difference (`add`)
 * is added to the stock as it is then, so a sale in between is kept; a
 * count (`set`) is written only while the stock is still the one the
 * seller saw. What the seller can act on comes back as a result, not an
 * error (`stockChangeErrorResult`): "moved" (STOCK_CHANGED, with the
 * stock now), "out-of-range" (STOCK_OUT_OF_RANGE), "gone"
 * (VARIANT_ARCHIVED, or NOT_FOUND). Anything else (the network, a 500)
 * is thrown, for the caller's message.
 *
 * After a save the answered variant replaces its copy in the product's
 * cache: its new stock and its new `version` (a detail refetch still on
 * its way is cancelled first, so it cannot answer the older product over
 * it). The product's `version`
 * does not move, so the edit form below the panel, if the seller has not
 * changed it, follows the new variant (ProductForm's `latest`) and its
 * next save is not refused for nothing. After any other result the
 * product is refetched: the panel then shows the stock the API reported.
 */
export const useQuickStockChange = (productId: string) => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: StockChange): Promise<StockChangeResult> => {
      try {
        const variant = await adjustVariantStock(
          authApi,
          productId,
          change.variantId,
          toStockAdjustment(change),
        );
        return savedStockChange(change, variant);
      } catch (error) {
        const result = stockChangeErrorResult(change, error);
        if (result === undefined) throw error;
        return result;
      }
    },
    onSuccess: async (result) => {
      if (result.kind === "saved") {
        // A refetch already on its way (the photo poll, the window
        // regaining the focus) may have read the product before this
        // change: cancelled first, or its answer would put the old stock
        // and the old `version` back over this one.
        await queryClient.cancelQueries({
          queryKey: productKeys.detail(productId),
        });
        queryClient.setQueryData<AdminProduct>(
          productKeys.detail(productId),
          (product) =>
            product && {
              ...product,
              variants: product.variants.map((variant) =>
                variant.id === result.variant.id ? result.variant : variant,
              ),
            },
        );
      } else {
        void queryClient.invalidateQueries({
          queryKey: productKeys.detail(productId),
        });
      }
      if (result.kind === "saved" || result.kind === "gone") {
        // The table's totals and "Stok menipis" changed (or a variant is
        // gone): refetched when the table is next on screen.
        void queryClient.invalidateQueries({ queryKey: productKeys.tables });
      }
    },
  });
};
