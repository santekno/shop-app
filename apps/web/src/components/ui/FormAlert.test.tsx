import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormAlert } from "./FormAlert.tsx";

const offline = () => ({ type: "server", message: "Tidak dapat terhubung." });

describe("FormAlert", () => {
  it("renders nothing without an error, or with an error without text", () => {
    const { container, rerender } = render(<FormAlert error={undefined} />);
    expect(container.innerHTML).toBe("");

    rerender(<FormAlert error={{ type: "server" }} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the message as an alert, out of the Tab order, and takes the focus", () => {
    render(<FormAlert error={{ message: "Email atau kata sandi salah." }} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Email atau kata sandi salah.");
    expect(alert.tabIndex).toBe(-1);
    expect(alert.className).toBe("error-text");
    expect(document.activeElement).toBe(alert);
  });

  it("takes the focus when an error appears later", () => {
    const { rerender } = render(<FormAlert error={undefined} />);
    expect(document.activeElement).toBe(document.body);

    rerender(<FormAlert error={offline()} />);
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("takes the focus again for a new error with the same text", () => {
    const outside = document.createElement("input");
    document.body.append(outside);
    const { rerender } = render(<FormAlert error={offline()} />);
    outside.focus();

    // setError creates a new object even when the text is the same.
    rerender(<FormAlert error={offline()} />);
    expect(document.activeElement).toBe(screen.getByRole("alert"));
    outside.remove();
  });

  it("leaves the focus alone when the form re-renders with the same error", () => {
    const outside = document.createElement("input");
    document.body.append(outside);
    const error = offline();
    const { rerender } = render(<FormAlert error={error} />);
    outside.focus();

    // Typing in a field re-renders the form; the error object is the same.
    rerender(<FormAlert error={error} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
