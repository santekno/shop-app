import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockBadge } from "./StockBadge.tsx";

describe("StockBadge", () => {
  it("says the stock ran out", () => {
    render(<StockBadge level="out" />);

    expect(screen.getByText("Stok habis")).toBeInTheDocument();
  });

  it("says the stock runs low, with where 'low' starts: the default 5", () => {
    render(<StockBadge level="low" />);

    expect(screen.getByText("Stok menipis")).toHaveAttribute(
      "title",
      "5 unit atau kurang",
    );
  });

  it("uses the threshold it is given (the API's low_stock_threshold)", () => {
    render(<StockBadge level="low" threshold={10} />);

    expect(screen.getByText("Stok menipis")).toHaveAttribute(
      "title",
      "10 unit atau kurang",
    );
  });

  it("renders nothing for enough stock", () => {
    const { container } = render(<StockBadge level="ok" />);

    expect(container).toBeEmptyDOMElement();
  });
});
