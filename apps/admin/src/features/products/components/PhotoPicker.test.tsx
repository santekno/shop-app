import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jpegFile } from "@/test/products-photos.ts";
import { PhotoPicker } from "./PhotoPicker.tsx";

const renderPicker = (slotsLeft = 10) => {
  const onFiles = vi.fn<(files: File[]) => void>();
  const view = render(<PhotoPicker slotsLeft={slotsLeft} onFiles={onFiles} />);
  const input =
    view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  const zone = input.parentElement;
  if (zone === null) throw new Error("no drop zone");
  return { onFiles, input, zone };
};

/** A drag event carrying `files` (or only text, with files = undefined). */
const drag = (
  type: "dragEnter" | "dragOver" | "dragLeave" | "drop",
  target: HTMLElement,
  files?: File[],
) => {
  const event = createEvent[type](target);
  const dataTransfer = {
    types: files === undefined ? ["text/plain"] : ["Files"],
    files: files ?? [],
    dropEffect: "none",
  };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(target, event);
  return { event, dataTransfer };
};

describe("PhotoPicker", () => {
  it("opens the file chooser from its button, for photos only, several at once", async () => {
    const user = userEvent.setup();
    const { input } = renderPicker(3);
    const click = vi.spyOn(input, "click");

    await user.click(screen.getByRole("button", { name: "Pilih foto" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input.multiple).toBe(true);
    expect(
      screen.getByRole("button", { name: "Pilih foto" }),
    ).toHaveAccessibleDescription(
      "Atau tarik foto ke sini. Masih bisa 3 foto lagi.",
    );
  });

  it("hands over the chosen files and empties the input, so the same file can be chosen again", async () => {
    const user = userEvent.setup();
    const { input, onFiles } = renderPicker();
    const files = [jpegFile("a.jpg"), jpegFile("b.jpg")];

    await user.upload(input, files);

    expect(onFiles).toHaveBeenCalledExactlyOnceWith(files);
    expect(input.value).toBe("");
  });

  it("hands over nothing when the chooser is closed without a file", () => {
    const { input, onFiles } = renderPicker();

    fireEvent.change(input, { target: { files: [] } });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("is disabled at 10 photos, saying why", () => {
    renderPicker(0);

    const button = screen.getByRole("button", { name: "Pilih foto" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "Produk ini sudah punya 10 foto. Hapus satu untuk menambah yang lain.",
    );
  });

  it("takes files dropped on it, showing the drop zone while dragging", () => {
    const { zone, onFiles } = renderPicker();
    const files = [jpegFile()];

    drag("dragEnter", zone, files);
    expect(zone).toHaveAttribute("data-dragging");
    const over = drag("dragOver", zone, files);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    expect(over.event.defaultPrevented).toBe(true);
    const drop = drag("drop", zone, files);

    expect(drop.event.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledExactlyOnceWith(files);
    expect(zone).not.toHaveAttribute("data-dragging");
  });

  it("stays highlighted while the drag moves over its children, until it really leaves", () => {
    const { zone } = renderPicker();

    drag("dragEnter", zone, []);
    drag("dragEnter", zone, []);
    drag("dragLeave", zone, []);
    expect(zone).toHaveAttribute("data-dragging");
    drag("dragLeave", zone, []);
    expect(zone).not.toHaveAttribute("data-dragging");
    // One leave too many (the browser sends them unevenly) must not leave
    // the count below zero: the next drag in and out ends cleanly.
    drag("dragLeave", zone, []);
    drag("dragEnter", zone, []);
    expect(zone).toHaveAttribute("data-dragging");
    drag("dragLeave", zone, []);
    expect(zone).not.toHaveAttribute("data-dragging");
  });

  it("refuses a drop when full, telling the browser so", () => {
    const { zone, onFiles } = renderPicker(0);

    const over = drag("dragOver", zone, [jpegFile()]);
    drag("drop", zone, [jpegFile()]);

    expect(over.dataTransfer.dropEffect).toBe("none");
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores a drag without files (text, a link)", () => {
    const { zone, onFiles } = renderPicker();

    const enter = drag("dragEnter", zone);
    const over = drag("dragOver", zone);
    drag("drop", zone);

    expect(enter.event.defaultPrevented).toBe(false);
    expect(over.event.defaultPrevented).toBe(false);
    expect(zone).not.toHaveAttribute("data-dragging");
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("does not count a leave without files", () => {
    const { zone } = renderPicker();

    drag("dragEnter", zone, []);
    drag("dragLeave", zone);

    expect(zone).toHaveAttribute("data-dragging");
  });
});
