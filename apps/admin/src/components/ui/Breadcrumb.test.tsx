import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./Breadcrumb.tsx";

describe("Breadcrumb", () => {
  it("is a named navigation with an ordered list, a plain link, a separator and the page", () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Dasbor</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Laporan</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );

    const nav = screen.getByRole("navigation", { name: "Jejak navigasi" });
    expect(within(nav).getByRole("list").tagName).toBe("OL");
    expect(within(nav).getByRole("link", { name: "Dasbor" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(nav).getByText("Laporan")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByText("Laporan").tagName).toBe("SPAN");
    // Two items: the separator is presentation only.
    expect(within(nav).getAllByRole("listitem")).toHaveLength(2);
  });
});
