import type { QueryClient } from "@tanstack/react-query";
import type { AdminProduct, AdminProductImage } from "@goshop/shared";
import { productKeys } from "./queries.ts";

/*
 * The product's photos live in its detail query (`images` of GET
 * /v1/admin/products/{id}), the one the edit page already has. Every photo
 * request answers the photo it changed, so the cache is updated from that
 * answer instead of refetching the whole product. The table's thumbnail
 * comes from the first ready photo, so every change also marks the table
 * stale (it refetches the next time it is on screen).
 */

const changeImages = (
  queryClient: QueryClient,
  productId: string,
  change: (images: AdminProductImage[]) => AdminProductImage[],
) => {
  queryClient.setQueryData<AdminProduct>(
    productKeys.detail(productId),
    (product) =>
      product === undefined
        ? undefined
        : { ...product, images: change(product.images) },
  );
  void queryClient.invalidateQueries({ queryKey: productKeys.tables });
};

/** Adds the photo, or replaces the one with its ID (a confirm's answer). */
export const upsertCachedImage = (
  queryClient: QueryClient,
  productId: string,
  image: AdminProductImage,
) => {
  changeImages(queryClient, productId, (images) =>
    images.some((existing) => existing.id === image.id)
      ? images.map((existing) => (existing.id === image.id ? image : existing))
      : [...images, image],
  );
};

/** Removes the photo with this ID (deleted, or refused at confirm). */
export const removeCachedImage = (
  queryClient: QueryClient,
  productId: string,
  imageId: string,
) => {
  changeImages(queryClient, productId, (images) =>
    images.filter((image) => image.id !== imageId),
  );
};
