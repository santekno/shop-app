import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field.tsx";
import { Textarea } from "./Textarea.tsx";

describe("Field", () => {
  it("names its control with the label and describes it with the hint", () => {
    render(
      <Field label="Deskripsi" hint="Opsional.">
        {(props) => <Textarea {...props} />}
      </Field>,
    );

    const control = screen.getByRole("textbox", { name: "Deskripsi" });
    expect(control.tagName).toBe("TEXTAREA");
    expect(control).toHaveAccessibleDescription("Opsional.");
    expect(control).not.toHaveAttribute("aria-invalid");
  });

  it("marks the control invalid and reads the hint, then the error", () => {
    render(
      <Field label="Kategori" hint="Pilih satu." error="Pilih kategori produk.">
        {(props) => (
          <select {...props}>
            <option value="">-</option>
          </select>
        )}
      </Field>,
    );

    const control = screen.getByRole("combobox", { name: "Kategori" });
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription(
      "Pilih satu. Pilih kategori produk.",
    );
  });

  it("describes nothing without a hint or an error", () => {
    render(<Field label="Status">{(props) => <input {...props} />}</Field>);

    expect(screen.getByRole("textbox", { name: "Status" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("takes any node as the hint, a button included", () => {
    render(
      <Field
        label="Kategori"
        hint={
          <>
            Gagal dimuat. <button type="button">Coba lagi</button>
          </>
        }
      >
        {(props) => <input {...props} />}
      </Field>,
    );

    expect(
      screen.getByRole("textbox", { name: "Kategori" }),
    ).toHaveAccessibleDescription("Gagal dimuat. Coba lagi");
  });
});
