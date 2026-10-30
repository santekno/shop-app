import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveProduct,
  createProduct,
  deleteProductImage,
  isApiError,
  updateProduct,
} from "@goshop/shared";
import type { AdminProduct, ProductWrite } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { removeCachedImage } from "../api/image-cache.ts";
import { productKeys } from "../api/queries.ts";

/**
 * The three writes of the product form, as TanStack Query mutations. Each
 * runs as the logged-in user (authApi) and keeps the cache honest
 * afterwards:
 *
 * - the saved product goes straight into its detail query (setQueryData):
 *   the API answers with the product as stored, so there is nothing to
 *   refetch;
 * - every page of the table is marked stale (invalidateQueries on the
 *   ["admin", "products", "table"] prefix): a name, a price or a status
 *   changed, and the table refetches when it is next on screen. It is not
 *   awaited: no table is on screen while the form is, so it would only
 *   delay the next step.
 */

/** POST /v1/admin/products. Resolves to the product as the API stored it. */
export const useCreateProduct = () => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductWrite) => createProduct(authApi, body),
    onSuccess: (product: AdminProduct) => {
      queryClient.setQueryData(productKeys.detail(product.id), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.tables });
    },
  });
};

/** PUT /v1/admin/products/{id}. Resolves to the saved product (new versions). */
export const useUpdateProduct = (id: string) => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductWrite) => updateProduct(authApi, id, body),
    onSuccess: (product: AdminProduct) => {
      queryClient.setQueryData(productKeys.detail(id), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.tables });
    },
  });
};

/**
 * DELETE /v1/admin/products/{id}: archives the product. The API answers
 * 204 with no body, so the product is fetched again (awaited: the edit
 * page shows the new status right after the dialog closes).
 */
export const useArchiveProduct = (id: string) => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => archiveProduct(authApi, id),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.tables });
      await queryClient.invalidateQueries({
        queryKey: productKeys.detail(id),
      });
    },
  });
};

/**
 * DELETE /v1/admin/products/{id}/images/{image_id}: deletes one photo and
 * its files. A photo that is already gone (404: deleted in another tab,
 * or refused at confirm) counts as deleted: what the seller wanted is
 * true. The photo leaves the product's cache either way.
 */
export const useDeleteProductImage = (productId: string) => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: string) => {
      try {
        await deleteProductImage(authApi, productId, imageId);
      } catch (error) {
        if (!isApiError(error, "NOT_FOUND")) throw error;
      }
    },
    onSuccess: (_, imageId) => {
      removeCachedImage(queryClient, productId, imageId);
    },
  });
};
