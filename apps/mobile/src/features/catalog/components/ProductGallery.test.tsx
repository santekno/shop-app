import { describe, expect, it, jest } from "@jest/globals";
import { Image } from "expo-image";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Dimensions, PixelRatio } from "react-native";
import type { ProductImage } from "@goshop/shared";

import { scrollView } from "@/test/list";
import { ProductGallery } from "./ProductGallery";

let n = 0;
const image = (alt = ""): ProductImage => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    url: `https://cdn.goshop.test/g${n}/800.jpg`,
    alt,
    width: 800,
    height: 800,
    variants: [
      { url: `https://cdn.goshop.test/g${n}/400.jpg`, width: 400, height: 400 },
      { url: `https://cdn.goshop.test/g${n}/800.jpg`, width: 800, height: 800 },
    ],
  };
};

const longDot = () =>
  screen.container
    .queryAll(
      (i) =>
        typeof i.props.className === "string" &&
        (i.props.className as string).includes("rounded-full") &&
        (i.props.className as string).includes("h-2"),
    )
    .map((i) => (i.props.className as string).includes("w-5"));

describe("ProductGallery", () => {
  it("shows 'Belum ada foto' and prefetches nothing without photos", async () => {
    await render(<ProductGallery images={[]} productName="Kaos" />);

    expect(screen.getByText("Belum ada foto")).toBeTruthy();
    expect(Image.prefetch).not.toHaveBeenCalled();
  });

  it("one photo: no dots, no prefetch", async () => {
    await render(<ProductGallery images={[image("Depan")]} productName="Kaos" />);

    expect(screen.getByRole("image", { name: "Depan, foto 1 dari 1" })).toBeTruthy();
    expect(longDot()).toEqual([]);
    expect(Image.prefetch).not.toHaveBeenCalled();
  });

  it("several photos: labelled by position, the product name stands in for an empty alt, one dot each", async () => {
    await render(
      <ProductGallery images={[image("Depan"), image(""), image("Belakang")]} productName="Kaos Polos" />,
    );

    expect(screen.getByRole("image", { name: "Depan, foto 1 dari 3" })).toBeTruthy();
    expect(screen.getByRole("image", { name: "Kaos Polos, foto 2 dari 3" })).toBeTruthy();
    expect(screen.getByRole("image", { name: "Belakang, foto 3 dari 3" })).toBeTruthy();
    expect(longDot()).toEqual([true, false, false]);
  });

  it("prefetches photos 2..n at the width the gallery draws them, not the first", async () => {
    jest.spyOn(PixelRatio, "get").mockReturnValue(1);
    const { width } = Dimensions.get("window");
    const images = [image(), image(), image()];
    await render(<ProductGallery images={images} productName="Kaos" />);

    // Dimensions in the test renderer are wider than every variant, so the widest.
    expect(width).toBeGreaterThan(0);
    await waitFor(() => {
      expect(Image.prefetch).toHaveBeenCalledTimes(1);
    });
    const [urls, policy] = jest.mocked(Image.prefetch).mock.calls[0] ?? [];
    expect(policy).toBe("memory-disk");
    expect(urls).toEqual([images[1]?.url, images[2]?.url]);
    jest.restoreAllMocks();
  });

  it("the dots follow the page the swipe came to rest on", async () => {
    const { width } = Dimensions.get("window");
    await render(
      <ProductGallery images={[image(), image(), image(), image()]} productName="Kaos" />,
    );

    fireEvent(scrollView(), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: width * 3 } },
    });

    await waitFor(() => {
      expect(longDot()).toEqual([false, false, false, true]);
    });
  });
});
