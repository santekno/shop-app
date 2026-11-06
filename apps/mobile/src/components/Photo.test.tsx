import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { PHOTO_FADE_MS, Photo } from "./Photo";

const view = () => {
  const [found] = screen.container.queryAll((i) => i.type === "ExpoImage");
  if (found === undefined) throw new Error("no image on screen");
  return found;
};

describe("Photo", () => {
  it("covers the box, caches in memory and disk, and fades in", async () => {
    await render(<Photo source={{ uri: "https://cdn.goshop.test/a.jpg" }} />);

    expect(view()).toHaveProp("contentFit", "cover");
    expect(view()).toHaveProp("cachePolicy", "memory-disk");
    expect(view()).toHaveProp("transition", PHOTO_FADE_MS);
    expect(PHOTO_FADE_MS).toBe(150);
  });

  it("shows the whole photo with fit='contain', and passes the accessibility props on", async () => {
    await render(
      <Photo
        source={{ uri: "https://cdn.goshop.test/a.jpg" }}
        fit="contain"
        recyclingKey="p1"
        accessible
        accessibilityRole="image"
        accessibilityLabel="Kaos, foto 1 dari 2"
      />,
    );

    expect(view()).toHaveProp("contentFit", "contain");
    expect(view()).toHaveProp("recyclingKey", "p1");
    expect(screen.getByRole("image", { name: "Kaos, foto 1 dari 2" })).toBeTruthy();
  });
});
