import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isApiError, updateProduct } from "@goshop/shared";
import type { AdminProduct, AdminVariant } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { adminProductQuery, productKeys } from "../api/queries.ts";
import { planStockChange } from "../stock.ts";
import type { StockChange, StockPlan } from "../stock.ts";

/** What a quick stock change ended with. */
export type QuickStockResult =
  | {
      kind: "saved";
      product: AdminProduct;
      variant: AdminVariant;
      from: number;
      to: number;
    }
  | Exclude<StockPlan, { kind: "write" }>;

/**
 * How many times a change is planned and sent when the API keeps
 * answering 409. Each 409 means something changed in the milliseconds
 * between the fetch and the write; three in a row means a very busy
 * product, and the seller is told instead of looping.
 */
const MAX_ATTEMPTS = 3;

/**
 * Changes one variant's stock without the product form (Bab 12 artikel
 * 05), on the API that exists: there is no stock endpoint, only PUT of
 * the whole product with every variant's version.
 *
 * Sound because it never writes from an old copy: it fetches the product
 * first (GET, never the cache), changes one stock in it, and sends it
 * back with the versions it just read (`planStockChange`). The window in
 * which a checkout can slip in is the time between those two requests,
 * and the versions close it: the API answers 409, and the change is
 * planned again from a new fetch. A difference (`add`) is simply applied
 * again to the new stock; a count (`set`) stops with "moved" if the stock
 * itself changed, because then only the seller knows which number is
 * right.
 *
 * Its cost: the PUT rewrites every variant, so every version moves, and
 * any other open form on this product (another tab, another admin) gets a
 * 409 on its next save. That form then shows what changed, so nothing is
 * lost, but it is why the API would do better with a stock endpoint of
 * its own (reported to backend-engineer).
 */
export const useQuickStockChange = (productId: string) => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: StockChange): Promise<QuickStockResult> => {
      for (let attempt = 1; ; attempt++) {
        // staleTime 0: always a request, never the cached copy. It also
        // refreshes the page's query, so the panel shows the stock the
        // plan was made from.
        const latest = await queryClient.query({
          ...adminProductQuery(authApi, productId),
          staleTime: 0,
        });
        const plan = planStockChange(change, latest);
        if (plan.kind !== "write") return plan;
        try {
          const product = await updateProduct(authApi, productId, plan.body);
          return {
            kind: "saved",
            product,
            variant: plan.variant,
            from: plan.from,
            to: plan.to,
          };
        } catch (error) {
          if (!isApiError(error, "VERSION_CONFLICT")) throw error;
          if (attempt >= MAX_ATTEMPTS) throw error;
        }
      }
    },
    onSuccess: (result) => {
      if (result.kind === "saved") {
        queryClient.setQueryData(productKeys.detail(productId), result.product);
      }
      // The table's totals and "Stok menipis" changed (or a variant is
      // gone): refetched when the table is next on screen.
      void queryClient.invalidateQueries({ queryKey: productKeys.tables });
    },
  });
};
