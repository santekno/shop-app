import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentTitle } from "./useDocumentTitle.ts";

beforeEach(() => {
  document.title = "GoShop";
});

describe("useDocumentTitle", () => {
  it("sets the title", () => {
    renderHook(() => {
      useDocumentTitle("Katalog — GoShop");
    });

    expect(document.title).toBe("Katalog — GoShop");
  });

  it("follows a new title", () => {
    const { rerender } = renderHook(
      ({ title }) => {
        useDocumentTitle(title);
      },
      { initialProps: { title: "Katalog — GoShop" } },
    );

    rerender({ title: "Kaos Polos — GoShop" });

    expect(document.title).toBe("Kaos Polos — GoShop");
  });

  it("puts the previous title back on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ title }) => {
        useDocumentTitle(title);
      },
      { initialProps: { title: "Katalog — GoShop" } },
    );
    rerender({ title: "Kaos Polos — GoShop" });

    unmount();

    expect(document.title).toBe("GoShop");
  });

  it("restores the outer title when a nested one leaves", () => {
    const outer = renderHook(() => {
      useDocumentTitle("Katalog — GoShop");
    });
    const inner = renderHook(() => {
      useDocumentTitle("Kaos Polos — GoShop");
    });
    expect(document.title).toBe("Kaos Polos — GoShop");

    inner.unmount();
    expect(document.title).toBe("Katalog — GoShop");
    outer.unmount();
    expect(document.title).toBe("GoShop");
  });
});
