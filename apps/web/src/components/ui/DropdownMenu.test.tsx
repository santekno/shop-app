import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu.tsx";

const renderMenu = (onSelect = vi.fn()) => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>budi@example.com</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Satu</DropdownMenuItem>
        <DropdownMenuItem className="font-bold" onSelect={onSelect}>
          Dua
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  return onSelect;
};

describe("DropdownMenu", () => {
  it("opens from its button and lets the arrow keys highlight an item", async () => {
    const events = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    await events.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const [first, second] = screen.getAllByRole("menuitem");
    if (first === undefined || second === undefined) throw new Error("items");
    await events.keyboard("{ArrowDown}");
    await events.keyboard("{ArrowDown}");

    // The highlighted item has the focus and data-highlighted, which the
    // classes below turn into the accent background and the ring's outline.
    expect(document.activeElement).toBe(second);
    expect(second.hasAttribute("data-highlighted")).toBe(true);
    expect(first.hasAttribute("data-highlighted")).toBe(false);
  });

  it("shows the highlighted item with the ring's outline, not only the faint accent", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem className="font-bold">Dua</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const item = screen.getByRole("menuitem", { name: "Dua" });
    const classes = [...item.classList];
    expect(classes).toEqual(
      expect.arrayContaining([
        "data-highlighted:bg-accent",
        "data-highlighted:outline-2",
        "data-highlighted:outline-solid",
        "data-highlighted:outline-ring",
        "data-highlighted:-outline-offset-2",
        // outline-hidden, not outline-none: forced colours still draw it.
        "outline-hidden",
      ]),
    );
    expect(classes).not.toContain("outline-none");
    // The caller's classes are added after its own.
    expect(classes.at(-1)).toBe("font-bold");
  });

  it("calls onSelect for the chosen item and closes, giving the focus back", async () => {
    const events = userEvent.setup();
    const onSelect = renderMenu();

    const trigger = screen.getByRole("button", { name: "Menu" });
    await events.click(trigger);
    await events.click(screen.getByRole("menuitem", { name: "Dua" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape", async () => {
    const events = userEvent.setup();
    renderMenu();

    await events.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await events.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is not modal: no scroll lock, so no <style> the CSP would block", async () => {
    const events = userEvent.setup();
    renderMenu();
    const styles = document.querySelectorAll("style").length;

    await events.click(screen.getByRole("button", { name: "Menu" }));

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.querySelectorAll("style")).toHaveLength(styles);
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("merges a className into the content's own", async () => {
    const events = userEvent.setup();
    renderMenu();

    await events.click(screen.getByRole("button", { name: "Menu" }));

    const menu = screen.getByRole("menu");
    expect(menu.classList.contains("w-60")).toBe(true);
    expect(menu.classList.contains("bg-popover")).toBe(true);
    expect(screen.getByText("budi@example.com").className).toContain(
      "font-medium",
    );
    expect(menu.querySelector('[role="separator"]')?.className).toContain(
      "bg-border",
    );
  });
});
