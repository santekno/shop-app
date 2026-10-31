import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { ScreenPlaceholder } from "./ScreenPlaceholder";

describe("ScreenPlaceholder", () => {
  it("shows the title as a heading and the message under it", async () => {
    await render(<ScreenPlaceholder title="Akun" message="Segera hadir." />);

    expect(screen.getByRole("header", { name: "Akun" })).toBeOnTheScreen();
    expect(screen.getByText("Segera hadir.")).toBeOnTheScreen();
  });
});
