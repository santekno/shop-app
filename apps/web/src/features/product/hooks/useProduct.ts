import { useCallback, useEffect, useState } from "react";
import { getProduct, isApiError } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { api } from "@/lib/api.ts";
import type { AsyncState } from "@/lib/async-state.ts";

interface Loaded {
  slug: string;
  attempt: number;
  state: AsyncState<Product>;
}

const loading = (slug: string, attempt = 0): Loaded => ({
  slug,
  attempt,
  state: { status: "loading" },
});

/**
 * Loads GET /v1/products/{slug}. `state` is loading, success (the product)
 * or error; a slug that names no product is an error whose code is
 * NOT_FOUND. `retry` asks again after an error. A new slug starts loading
 * at once, and leaving the page aborts the request.
 */
export const useProduct = (slug: string) => {
  const [current, setCurrent] = useState(() => loading(slug));
  // Another slug: start again from "loading" while rendering, the same way
  // useProducts starts a new list, so the previous product never shows.
  if (current.slug !== slug) {
    setCurrent(loading(slug));
  }
  const { attempt } = current;

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const product = await getProduct(api, slug, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCurrent({
          slug,
          attempt,
          state: { status: "success", data: product },
        });
      } catch (error) {
        if (controller.signal.aborted || isApiError(error, "ABORTED")) return;
        setCurrent({ slug, attempt, state: { status: "error", error } });
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  const retry = useCallback(() => {
    setCurrent((prev) =>
      prev.slug === slug ? loading(slug, prev.attempt + 1) : prev,
    );
  }, [slug]);

  return { state: current.state, retry };
};
