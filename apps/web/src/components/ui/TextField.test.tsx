import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { TextField } from "./TextField.tsx";

const input = () => screen.getByRole("textbox");

describe("TextField", () => {
  it("names the input by its label, and a click on the label focuses it", async () => {
    const user = userEvent.setup();
    render(<TextField label="Email" />);

    await user.click(screen.getByText("Email"));

    expect(screen.getByRole("textbox", { name: "Email" })).toBe(
      document.activeElement,
    );
    expect(input().hasAttribute("aria-invalid")).toBe(false);
    expect(input().hasAttribute("aria-describedby")).toBe(false);
  });

  it("describes the input with its hint", () => {
    render(<TextField label="Kata sandi" hint="8 sampai 128 karakter." />);

    const hint = screen.getByText("8 sampai 128 karakter.");
    expect(input().getAttribute("aria-describedby")).toBe(hint.id);
    expect(input().hasAttribute("aria-invalid")).toBe(false);
  });

  it("marks the input invalid and describes it with the error after the hint", () => {
    render(
      <TextField
        label="Nama"
        hint="Nama lengkap."
        error="Masukkan nama Anda."
      />,
    );

    const hint = screen.getByText("Nama lengkap.");
    const error = screen.getByText("Masukkan nama Anda.");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().getAttribute("aria-describedby")).toBe(
      `${hint.id} ${error.id}`,
    );
    expect(
      screen.getByRole("textbox", {
        description: "Nama lengkap. Masukkan nama Anda.",
      }),
    ).toBe(input());
  });

  it("uses a given id for the input and its hint and error ids", () => {
    render(<TextField label="Email" id="email" error="Salah." />);

    expect(input().id).toBe("email");
    expect(input().getAttribute("aria-describedby")).toBe("email-error");
  });

  it("gives each field its own ids", () => {
    render(
      <>
        <TextField label="A" error="x" />
        <TextField label="B" error="y" />
      </>,
    );

    const [a, b] = screen.getAllByRole("textbox");
    expect(a?.id).not.toBe(b?.id);
    expect(a?.getAttribute("aria-describedby")).not.toBe(
      b?.getAttribute("aria-describedby"),
    );
  });

  it("passes every other prop, ref included, to the input", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <TextField
        label="Email"
        ref={ref}
        type="email"
        name="email"
        autoComplete="email"
        defaultValue="budi@example.com"
      />,
    );

    expect(ref.current).toBe(input());
    expect(input().getAttribute("type")).toBe("email");
    expect(input().getAttribute("name")).toBe("email");
    expect(input().getAttribute("autocomplete")).toBe("email");
    expect((input() as HTMLInputElement).value).toBe("budi@example.com");
  });
});
