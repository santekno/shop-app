import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { useLateHeadingFocus } from "./useLateHeadingFocus.ts";

function LateHeading() {
  const headingRef = useLateHeadingFocus();
  return (
    <h1 ref={headingRef} tabIndex={-1}>
      Produk dimuat
    </h1>
  );
}

/** A page whose heading appears only after "loading". */
function Page() {
  const [loaded, setLoaded] = useState(false);
  return (
    <main tabIndex={-1}>
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
        }}
      >
        Muat
      </button>
      {loaded && <LateHeading />}
    </main>
  );
}

const load = () => {
  act(() => {
    screen.getByRole("button", { name: "Muat" }).click();
  });
};

describe("useLateHeadingFocus", () => {
  it("takes the focus from <main> when the heading arrives", () => {
    render(<Page />);
    act(() => {
      screen.getByRole("main").focus();
    });

    load();

    expect(
      screen.getByRole("heading", { name: "Produk dimuat" }),
    ).toHaveFocus();
  });

  it("leaves the focus where the user put it", () => {
    render(<Page />);
    const button = screen.getByRole("button", { name: "Muat" });
    act(() => {
      button.focus();
    });

    load();

    expect(button).toHaveFocus();
  });
});
