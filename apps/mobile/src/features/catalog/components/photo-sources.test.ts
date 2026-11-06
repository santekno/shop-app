import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Image } from "expo-image";
import { PixelRatio } from "react-native";
import type { ProductImage } from "@goshop/shared";

import { photoSources, prefetchPhotos, urlForWidth } from "./photo-sources";

// Image.prefetch is the jest.fn of src/test/mocks/expo-image.tsx; spyOn hands
// it back as it is, and keeps the lint rule about unbound methods quiet.
const prefetchSpy = () =>
  jest.spyOn(Image, "prefetch") as unknown as jest.Mock<
    (urls: string | string[], cachePolicy?: string) => Promise<boolean>
  >;

const image = (overrides: Partial<ProductImage> = {}): ProductImage => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  url: "https://cdn.goshop.test/p/full.jpg",
  alt: "",
  width: 1200,
  height: 1200,
  variants: [
    { url: "https://cdn.goshop.test/p/800.jpg", width: 800, height: 800 },
    { url: "https://cdn.goshop.test/p/400.jpg", width: 400, height: 400 },
  ],
  ...overrides,
});

const density = (ratio: number) =>
  jest.spyOn(PixelRatio, "get").mockReturnValue(ratio);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("photoSources", () => {
  it("lists every variant as a source with its size", () => {
    expect(photoSources(image())).toEqual([
      { uri: "https://cdn.goshop.test/p/800.jpg", width: 800, height: 800 },
      { uri: "https://cdn.goshop.test/p/400.jpg", width: 400, height: 400 },
    ]);
  });

  it("uses the photo's own url when it has no variants", () => {
    expect(photoSources(image({ variants: [] }))).toEqual([
      { uri: "https://cdn.goshop.test/p/full.jpg", width: 1200, height: 1200 },
    ]);
  });
});

describe("urlForWidth", () => {
  it("picks the smallest variant that covers the box at this density", () => {
    density(2);

    expect(urlForWidth(image(), 180)).toBe("https://cdn.goshop.test/p/400.jpg");
    expect(urlForWidth(image(), 200)).toBe("https://cdn.goshop.test/p/400.jpg");
    expect(urlForWidth(image(), 201)).toBe("https://cdn.goshop.test/p/800.jpg");
  });

  it("takes the widest when none covers the box", () => {
    density(3);

    expect(urlForWidth(image(), 360)).toBe("https://cdn.goshop.test/p/800.jpg");
  });

  it("takes the photo's url when there are no variants", () => {
    density(2);

    expect(urlForWidth(image({ variants: [] }), 100)).toBe(
      "https://cdn.goshop.test/p/full.jpg",
    );
  });
});

describe("prefetchPhotos", () => {
  it("downloads into memory and disk, and does not ask twice for the same URL", () => {
    prefetchPhotos(["https://cdn.goshop.test/pf/a.jpg"]);
    prefetchPhotos([
      "https://cdn.goshop.test/pf/a.jpg",
      "https://cdn.goshop.test/pf/b.jpg",
    ]);

    expect(prefetchSpy()).toHaveBeenCalledTimes(2);
    expect(prefetchSpy()).toHaveBeenNthCalledWith(
      1,
      ["https://cdn.goshop.test/pf/a.jpg"],
      "memory-disk",
    );
    expect(prefetchSpy()).toHaveBeenNthCalledWith(
      2,
      ["https://cdn.goshop.test/pf/b.jpg"],
      "memory-disk",
    );
  });

  it("does nothing for an empty list", () => {
    prefetchPhotos([]);

    expect(prefetchSpy()).not.toHaveBeenCalled();
  });

  it("forgets URLs that failed, so a later call may try again", async () => {
    const url = "https://cdn.goshop.test/pf/fail.jpg";
    prefetchSpy().mockRejectedValueOnce(new Error("offline"));

    prefetchPhotos([url]);
    await Promise.resolve();
    await Promise.resolve();
    prefetchPhotos([url]);

    expect(prefetchSpy()).toHaveBeenCalledTimes(2);
  });
});
