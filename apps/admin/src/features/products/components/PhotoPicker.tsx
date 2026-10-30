import { useId, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ImagePlus } from "lucide-react";
import { PRODUCT_IMAGES_MAX, PRODUCT_IMAGE_TYPES } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";

interface PhotoPickerProps {
  /** How many more photos the product may have (10, minus every photo and upload). */
  slotsLeft: number;
  /** The files the seller chose or dropped, in their order. */
  onFiles: (files: File[]) => void;
}

/** Whether a drag carries files (not a link or text dragged from the page). */
const carriesFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

/**
 * Two ways to choose photos: the "Pilih foto" button, and dropping files
 * on the dashed area.
 *
 * The button is the accessible way, and the only one a keyboard or a
 * screen reader needs: it is a real <button> that opens the browser's own
 * file dialog through a hidden <input type="file">. The input itself is
 * hidden because a file input cannot be styled and reads differently in
 * every browser; `hidden` also keeps it out of the Tab order, so the
 * button is the one stop. Its `accept` makes the dialog offer photos
 * first, but it is a hint, not a check: the checks run after the choice
 * (checkPhotoFile).
 *
 * Dragging is an extra for a mouse. A drag fires dragenter and dragleave
 * for every child element it crosses, so the highlight counts how deep it
 * is instead of switching off on the first dragleave. `preventDefault` on
 * dragover is what makes the area a drop target at all; without it the
 * browser would open the dropped file in the tab.
 */
export function PhotoPicker({ slotsLeft, onFiles }: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();
  const full = slotsLeft === 0;

  return (
    <div
      data-dragging={dragging ? "" : undefined}
      className="grid justify-items-center gap-3 rounded-lg border-2 border-dashed border-border p-6 text-center data-dragging:border-primary data-dragging:bg-accent"
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = full ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!full) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <ImagePlus aria-hidden="true" className="size-8 text-muted-foreground" />
      <Button
        disabled={full}
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
      >
        Pilih foto
      </Button>
      <p id={hintId} className="text-sm text-muted-foreground">
        {full
          ? `Produk ini sudah punya ${PRODUCT_IMAGES_MAX} foto. Hapus satu untuk menambah yang lain.`
          : `Atau tarik foto ke sini. Masih bisa ${slotsLeft} foto lagi.`}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={PRODUCT_IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          // Emptied, so choosing the same file again is a change again
          // (to retry a file that was refused, say).
          event.currentTarget.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}
