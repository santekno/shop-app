import { describe, expect, it } from "@jest/globals";

import { apiError, fakeApi, json } from "@/test/fake-api";
import { fetchBanners } from "./banners";

const banner = {
  id: "00000000-0000-4000-8000-0000000000b1",
  title: "Kaos Baru",
  subtitle: null,
  cta_label: null,
  link_category_slug: null,
  background_color: "#1E40AF",
};

describe("fetchBanners", () => {
  it("returns the list inside the { data } envelope", async () => {
    fakeApi.on("GET", "/v1/banners", () => json({ data: [banner] }));

    await expect(fetchBanners()).resolves.toEqual([banner]);
    expect(fakeApi.requests("GET", "/v1/banners")).toHaveLength(1);
  });

  it("returns an empty list when the shop has no banner", async () => {
    fakeApi.on("GET", "/v1/banners", () => json({ data: [] }));

    await expect(fetchBanners()).resolves.toEqual([]);
  });

  it("rejects with the API's error", async () => {
    fakeApi.on("GET", "/v1/banners", () => apiError(500, "INTERNAL", "r-1"));

    await expect(fetchBanners()).rejects.toMatchObject({ status: 500 });
  });
});
