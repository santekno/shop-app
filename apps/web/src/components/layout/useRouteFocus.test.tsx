import { act, render, screen } from "@testing-library/react";
import Link from "next/link";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { startAt, testRouter, usePathname } from "@/test/memory-router.ts";
import { useRouteFocus } from "./useRouteFocus.ts";

/** The page at the current path, as the app/ folder would pick it. */
function Page() {
  const pathname = usePathname();
  if (pathname === "/") return <Catalog />;
  if (pathname.startsWith("/produk/")) return <h1 tabIndex={-1}>Produk</h1>;
  return <p>Belum ada judul</p>;
}

/** SiteFrame's part: <main> around the page, focused by the hook. */
function Layout() {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  return (
    <main ref={mainRef} tabIndex={-1}>
      <Page />
    </main>
  );
}

function Catalog() {
  return (
    <>
      <h1 tabIndex={-1}>Katalog</h1>
      <Link href="/produk/kaos" data-product-slug="kaos">
        Kaos
      </Link>
    </>
  );
}

const setup = (url = "/") => {
  startAt(url);
  render(<Layout />);
  const go = (to: string) => {
    act(() => {
      testRouter.push(to);
    });
  };
  const back = () => {
    act(() => {
      testRouter.back();
    });
  };
  return { go, back };
};

const heading = (name: string) =>
  screen.getByRole("heading", { level: 1, name });

describe("useRouteFocus", () => {
  it("moves nothing on the first render", () => {
    setup("/");

    expect(document.activeElement).toBe(document.body);
  });

  it("focuses the new page's h1 after a navigation, without scrolling", () => {
    const { go } = setup("/");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    go("/produk/kemeja");

    expect(document.activeElement).toBe(heading("Produk"));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it("returns to the card of the product the buyer came back from, scrolling to it", () => {
    const { go } = setup("/produk/kaos");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    go("/");

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Kaos" }),
    );
    expect(focus).toHaveBeenLastCalledWith();
    focus.mockRestore();
  });

  it("falls back to the h1 when the product has no card on the page", () => {
    const { go } = setup("/produk/lain");

    go("/");

    expect(document.activeElement).toBe(heading("Katalog"));
  });

  it("focuses <main> when the page has no h1 yet", () => {
    const { go } = setup("/");

    go("/kosong");

    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("leaves the focus where it is when only the query string changes", () => {
    const { go } = setup("/");
    const link = screen.getByRole("link", { name: "Kaos" });
    link.focus();

    go("/?kategori=kaos");
    go("/?kategori=kaos&urut=termurah");

    expect(document.activeElement).toBe(link);
  });

  it("handles Back like any other navigation", () => {
    const { go, back } = setup("/");
    go("/produk/kaos");

    back();

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Kaos" }),
    );
  });
});
