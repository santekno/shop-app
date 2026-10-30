import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminProductImage } from "@goshop/shared";
import { productKeys } from "../api/queries.ts";

/**
 * The waits between two looks at the product, growing: the worker picks
 * up new photos every 30 seconds (ADR 0007), so the first looks are quick
 * (a photo is often ready within seconds of the tick) and the later ones
 * back off to every 8 seconds instead of asking the API every second.
 */
export const POLL_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000] as const;

/** After this long the page stops asking and offers a button instead. */
export const POLL_LIMIT_MS = 120_000;

/** The wait before look number `attempt` (0, 1, 2, …). */
export const pollDelay = (attempt: number): number =>
  POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)] ??
  POLL_DELAYS_MS[0];

/**
 * Refetches product `productId` while any of its photos is `processing`,
 * until none is, with a growing wait (pollDelay) and for at most
 * POLL_LIMIT_MS. There is no endpoint for one photo, and the product is
 * the query the page already shows: a refetch updates every photo at once.
 *
 * The polling restarts (from a short wait) whenever the set of processing
 * photos changes: one became ready, so the others are probably close.
 * When the limit is reached, `gaveUp` is true and the page says the worker
 * is slow; `check()` looks once more and starts a new round.
 *
 * `gaveUp` is derived, not reset: it holds the set of photos it gave up
 * on, so a new set (a photo ready, a new upload) clears it by itself.
 */
export const useProcessingPoll = (
  productId: string,
  images: readonly AdminProductImage[],
) => {
  const queryClient = useQueryClient();
  const processing = images
    .filter((image) => image.status === "processing")
    .map((image) => image.id)
    .sort()
    .join(",");
  const [gaveUpOn, setGaveUpOn] = useState<string | undefined>(undefined);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (processing === "") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let attempt = 0;

    const lookAgain = () => {
      timer = setTimeout(() => {
        void (async () => {
          if (Date.now() - startedAt >= POLL_LIMIT_MS) {
            setGaveUpOn(processing);
            return;
          }
          attempt += 1;
          // A failed look (the network) is not the end: the next one may
          // work. refetchQueries does not throw.
          await queryClient.refetchQueries({
            queryKey: productKeys.detail(productId),
            exact: true,
          });
          // The table's thumbnail is the first ready photo.
          void queryClient.invalidateQueries({ queryKey: productKeys.tables });
          if (!cancelled) lookAgain();
        })();
      }, pollDelay(attempt));
    };
    lookAgain();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [processing, productId, queryClient, round]);

  return {
    gaveUp: processing !== "" && gaveUpOn === processing,
    check: () => {
      setGaveUpOn(undefined);
      setRound((value) => value + 1);
    },
  };
};
