import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakePaymentHint } from "./FakePaymentHint.tsx";

describe("FakePaymentHint", () => {
  it("tells the developer how to pay this order from a terminal", () => {
    render(<FakePaymentHint code="GS-20261030-7KQ2M9" />);

    expect(
      screen.getByText("Mode uji: gateway pembayaran palsu"),
    ).toBeDefined();
    expect(
      screen.getByText("make fake-pay order=GS-20261030-7KQ2M9").tagName,
    ).toBe("CODE");
    expect(screen.getByText("status=expire")).toBeDefined();
    expect(screen.getByText("status=deny")).toBeDefined();
  });
});
