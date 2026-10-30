import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SkipLink } from "./SkipLink.tsx";

describe("SkipLink", () => {
  it("is the first link, pointing at the main content", () => {
    render(<SkipLink />);

    expect(
      screen.getByRole("link", { name: "Langsung ke konten utama" }),
    ).toHaveAttribute("href", "#konten");
  });

  it("moves the focus to <main> without following the fragment", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink />
        <button type="button">Menu</button>
        <main id="konten" tabIndex={-1}>
          <a href="/x">Isi</a>
        </main>
      </>,
    );

    await user.click(
      screen.getByRole("link", { name: "Langsung ke konten utama" }),
    );

    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.location.hash).toBe("");
    await user.tab();
    expect(screen.getByRole("link", { name: "Isi" })).toHaveFocus();
  });

  it("follows the link as usual when the page has no <main>", async () => {
    const user = userEvent.setup();
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: "Langsung ke konten utama" });

    await user.click(link);

    expect(window.location.hash).toBe("#konten");
    window.history.replaceState(null, "", "/");
  });
});
