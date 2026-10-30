/** A set of the last `capacity` IDs seen, for dropping duplicates. */
export interface RecentIds {
  /** True the first time `id` is seen; false for a repeat. Remembers it. */
  add: (id: string) => boolean;
}

/**
 * A set that forgets its oldest entry when it is full: memory stays
 * bounded however long the tab is open. A JavaScript Set keeps insertion
 * order, so its first value is the oldest.
 *
 * Duplicates arrive close together (the outbox dispatcher publishing the
 * same event again after a failed run, at most a few seconds later), so
 * remembering the last few hundred is plenty.
 */
export const createRecentIds = (capacity = 500): RecentIds => {
  const seen = new Set<string>();
  return {
    add: (id: string) => {
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > capacity) {
        const oldest = seen.values().next();
        if (oldest.done !== true) seen.delete(oldest.value);
      }
      return true;
    },
  };
};
