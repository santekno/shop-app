import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useLateHeadingFocus } from "./useLateHeadingFocus.ts";

function LateHeading() {
  const headingRef = useLateHeadingFocus();
  return (
    <h1 ref={headingRef} tabIndex={-1}>
      Kaos Polos
    </h1>
  );
}

function Page({ loaded }: { loaded: boolean }) {
  const [, setTick] = useState(0);
  return (
    <main tabIndex={-1}>
      <button
        type="button"
        onClick={() => {
          setTick((n) => n + 1);
        }}
      >
        Tombol
      </button>
      {loaded && <LateHeading />}
    </main>
  );
}

describe("useLateHeadingFocus", () => {
  it("takes the focus over from <main> when the heading arrives", () => {
    const { rerender } = render(<Page loaded={false} />);
    screen.getByRole("main").focus();

    rerender(<Page loaded />);

    expect(document.activeElement).toBe(screen.getByRole("heading"));
  });

  it("leaves the focus alone when the buyer has moved on", () => {
    const { rerender } = render(<Page loaded={false} />);
    const button = screen.getByRole("button", { name: "Tombol" });
    button.focus();

    rerender(<Page loaded />);

    expect(document.activeElement).toBe(button);
  });

  it("leaves the focus alone on a fresh page load", () => {
    render(<Page loaded />);

    expect(document.activeElement).toBe(document.body);
  });
});
