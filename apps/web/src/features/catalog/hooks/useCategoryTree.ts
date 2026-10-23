import { useCallback, useEffect, useState } from "react";
import { buildCategoryTree, isApiError, listCategories } from "@goshop/shared";
import type { CategoryNode } from "@goshop/shared";
import { api } from "@/lib/api.ts";
import type { AsyncState } from "@/lib/async-state.ts";

export type { AsyncState } from "@/lib/async-state.ts";

/**
 * Loads GET /v1/categories once and returns it as a tree, plus `reload` to
 * try again after an error.
 *
 * Leaving the page aborts the request, like cancelling a Go context: the
 * effect's cleanup calls `controller.abort()`. A request that was aborted
 * never updates the state, so an old answer cannot overwrite a newer one.
 */
export const useCategoryTree = () => {
  const [state, setState] = useState<AsyncState<CategoryNode[]>>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const categories = await listCategories(api, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({ status: "success", data: buildCategoryTree(categories) });
      } catch (error) {
        if (controller.signal.aborted || isApiError(error, "ABORTED")) return;
        setState({ status: "error", error });
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, reload };
};
