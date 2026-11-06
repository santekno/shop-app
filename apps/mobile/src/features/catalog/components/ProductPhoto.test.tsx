import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import type { ProductImage } from "@goshop/shared";

import { ProductPhoto } from "./ProductPhoto";

const image = (overrides: Partial<ProductImage> = {}): ProductImage => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  url: "https://cdn.goshop.test/p/kaos-800.jpg",
  alt: "",
  width: 800,
  height: 800,
  variants: [
    { url: "https://cdn.goshop.test/p/kaos-400.jpg", width: 400, height: 400 },
    { url: "https://cdn.goshop.test/p/kaos-800.jpg", width: 800, height: 800 },
  ],
  ...overrides,
});

/** The native image view the photo draws (expo-image, src/test/mocks). */
const photoView = () => {
  const [view] = screen.container.queryAll((i) => i.type === "ExpoImage");
  if (view === undefined) throw new Error("no image on screen");
  return view;
};

describe("ProductPhoto", () => {
  it("hands every variant to Image as a source list, narrowest first", async () => {
    await render(<ProductPhoto image={image()} />);

    expect(photoView()).toHaveProp("source", [
      {
        uri: "https://cdn.goshop.test/p/kaos-400.jpg",
        width: 400,
        height: 400,
      },
      {
        uri: "https://cdn.goshop.test/p/kaos-800.jpg",
        width: 800,
        height: 800,
      },
    ]);
    expect(photoView()).toHaveProp("contentFit", "cover");
    expect(photoView()).toHaveProp("recyclingKey", image().id);
    expect(screen.queryByText("Belum ada foto")).not.toBeOnTheScreen();
  });

  it("caches the photo in memory and on disk and fades it in", async () => {
    await render(<ProductPhoto image={image()} />);

    expect(photoView()).toHaveProp("cachePolicy", "memory-disk");
    expect(photoView()).toHaveProp("transition", 150);
  });

  it("falls back to url when the photo has no variants", async () => {
    await render(
      <ProductPhoto
        image={image({
          url: "https://cdn.goshop.test/p/kecil.jpg",
          width: 300,
          height: 240,
          variants: [],
        })}
      />,
    );

    expect(photoView()).toHaveProp("source", [
      { uri: "https://cdn.goshop.test/p/kecil.jpg", width: 300, height: 240 },
    ]);
  });

  it("draws a placeholder while the product has no photo", async () => {
    await render(<ProductPhoto image={undefined} />);

    expect(screen.getByText("Belum ada foto")).toBeOnTheScreen();
    expect(screen.container.queryAll((i) => i.type === "ExpoImage")).toEqual(
      [],
    );
  });
});
