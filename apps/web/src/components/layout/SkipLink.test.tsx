import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/render.tsx";
import { SkipLink } from "./SkipLink.tsx";

const skipLink = () =>
  screen.getByRole("link", { name: "Langsung ke konten utama" });

describe("SkipLink", () => {
  it("focuses the target itself and keeps the #fragment out of the URL", () => {
    render(
      <>
        <SkipLink targetId="konten" />
        <main id="konten" tabIndex={-1}>
          Isi
        </main>
      </>,
    );
    expect(skipLink().getAttribute("href")).toBe("#konten");

    // fireEvent returns false when a handler called preventDefault.
    const followed = fireEvent.click(skipLink());

    expect(followed).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("is a plain link when the target is missing", () => {
    render(<SkipLink targetId="tidak-ada" />);
    const before = document.activeElement;

    const followed = fireEvent.click(skipLink());

    expect(followed).toBe(true);
    expect(document.activeElement).toBe(before);
  });

  it("is the first stop for Tab on every page, and skips to <main>", async () => {
    const events = userEvent.setup();
    const { router } = renderApp("/masuk");
    await screen.findByRole("heading", { level: 1, name: "Masuk" });

    // The router may have focused <main> on mount; start from the top.
    (document.activeElement as HTMLElement | null)?.blur();
    await events.tab();
    expect(document.activeElement).toBe(skipLink());

    await events.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(screen.getByRole("main").id).toBe("konten");
    // No navigation: no #konten entry in the history.
    expect(window.location.hash).toBe("");
    expect(router.entries).toEqual(["/masuk"]);
    expect(router.lastAction).toBe("start");
  });
});
