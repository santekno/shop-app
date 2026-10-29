import { render, screen } from "@testing-library/react";
import type { OrderStatus } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { OrderStatusBadge } from "./OrderStatusBadge.tsx";

describe("OrderStatusBadge", () => {
  it.each<[OrderStatus, string, string]>([
    ["pending_payment", "Menunggu pembayaran", "bg-primary"],
    ["cancelled", "Dibatalkan", "text-destructive"],
    ["paid", "Dibayar", "bg-muted"],
    ["processing", "Diproses penjual", "bg-muted"],
    ["shipped", "Dikirim", "bg-muted"],
    ["completed", "Selesai", "bg-muted"],
  ])("labels %s as %s, the colour repeating it", (status, text, look) => {
    render(<OrderStatusBadge status={status} />);

    const badge = screen.getByText(text);
    expect(badge.classList.contains("order-status")).toBe(true);
    expect(badge.classList.contains(look)).toBe(true);
  });
});
