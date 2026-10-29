import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLoading } from "./AppLoading.tsx";

describe("AppLoading", () => {
  it("announces that the storefront is loading", () => {
    render(<AppLoading />);

    expect(screen.getByRole("status").textContent).toBe("Memuat GoShop…");
  });
});
