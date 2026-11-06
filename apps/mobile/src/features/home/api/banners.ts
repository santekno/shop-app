// The home screen's banners: GET /v1/banners, the carousel's cards.
//
// @goshop/shared has no endpoint function for it yet (the storefront has no
// carousel), so the call is written here against the generated types: the
// shape is the contract's (api/openapi.yaml), only the one-line request is
// the app's. If the web gets a carousel, the function moves to
// packages/shared/src/api/catalog.ts and this file shrinks to a re-export.
import type { components } from "@goshop/shared";
import { api } from "@/lib/api";

/** One card of the carousel: coloured text, no image. */
export type Banner = components["schemas"]["Banner"];

type BannerList = components["schemas"]["BannerList"];

/**
 * GET /v1/banners: the active banners in display order, possibly none.
 * Public, not paginated. Returns the list, not the `{ data }` envelope,
 * like listCategories. `signal` cancels the request.
 */
export const fetchBanners = async (signal?: AbortSignal): Promise<Banner[]> => {
  const body = await api.request<BannerList>("/v1/banners", { signal });
  return body.data;
};
