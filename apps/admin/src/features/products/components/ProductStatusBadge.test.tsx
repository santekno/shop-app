import type { AdminProductStatus } from "@goshop/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductStatusBadge } from "./ProductStatusBadge.tsx";

describe("ProductStatusBadge", () => {
  it.each<[AdminProductStatus, string, string]>([
    ["active", "Aktif", "text-success"],
    ["draft", "Draf", "bg-muted"],
    ["archived", "Diarsipkan", "text-muted-foreground"],
  ])("shows %s as '%s' in its own look", (status, label, look) => {
    render(<ProductStatusBadge status={status} />);

    expect(screen.getByText(label)).toHaveClass(look);
  });

  it("shows a status it does not know as the API wrote it", () => {
    render(
      <ProductStatusBadge status={"hidden" as unknown as AdminProductStatus} />,
    );

    expect(screen.getByText("hidden")).toBeInTheDocument();
  });
});
