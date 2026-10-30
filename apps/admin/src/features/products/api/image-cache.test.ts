import type { AdminProduct } from "@goshop/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { PRODUCT_ID, adminImage, adminProduct } from "@/test/fixtures.ts";
import { removeCachedImage, upsertCachedImage } from "./image-cache.ts";
import { productKeys } from "./queries.ts";

const seeded = (images = [adminImage(1), adminImage(2)]) => {
  const client = new QueryClient();
  client.setQueryData(productKeys.detail(PRODUCT_ID), adminProduct({ images }));
  client.setQueryData(productKeys.table({ page: 1 }), { data: [] });
  return client;
};

const images = (client: QueryClient) =>
  client.getQueryData<AdminProduct>(productKeys.detail(PRODUCT_ID))?.images;

const tableInvalidated = (client: QueryClient) =>
  client.getQueryState(productKeys.table({ page: 1 }))?.isInvalidated;

describe("upsertCachedImage", () => {
  it("adds a new photo at the end", () => {
    const client = seeded();
    const added = adminImage(3, { status: "pending_upload" });

    upsertCachedImage(client, PRODUCT_ID, added);

    expect(images(client)?.map((i) => i.id)).toEqual([
      adminImage(1).id,
      adminImage(2).id,
      added.id,
    ]);
    expect(tableInvalidated(client)).toBe(true);
  });

  it("replaces the photo with the same ID in place", () => {
    const client = seeded([
      adminImage(1, { status: "processing" }),
      adminImage(2),
    ]);

    upsertCachedImage(client, PRODUCT_ID, adminImage(1));

    expect(images(client)?.map((i) => i.status)).toEqual(["ready", "ready"]);
    expect(images(client)?.[0]?.id).toBe(adminImage(1).id);
    expect(images(client)).toHaveLength(2);
  });

  it("creates no product that was not cached, but still marks the table stale", () => {
    const client = new QueryClient();
    client.setQueryData(productKeys.table({ page: 1 }), { data: [] });

    upsertCachedImage(client, PRODUCT_ID, adminImage(1));

    expect(client.getQueryData(productKeys.detail(PRODUCT_ID))).toBeUndefined();
    expect(tableInvalidated(client)).toBe(true);
  });
});

describe("removeCachedImage", () => {
  it("removes only the photo with that ID", () => {
    const client = seeded();

    removeCachedImage(client, PRODUCT_ID, adminImage(1).id);

    expect(images(client)?.map((i) => i.id)).toEqual([adminImage(2).id]);
    expect(tableInvalidated(client)).toBe(true);
  });

  it("changes nothing for an unknown ID", () => {
    const client = seeded();

    removeCachedImage(client, PRODUCT_ID, "unknown");

    expect(images(client)).toHaveLength(2);
  });
});
