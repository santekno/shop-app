// The frame around every page (Bab 11 artikel 08, 13): skip link, header,
// <main>, and the analytics footer only when analytics is on.
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "@/features/analytics/gtag-init.ts";
import { fetchMock } from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import { SiteFrame } from "./SiteFrame.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => undefined));
  // jsdom has no ResizeObserver; the consent banner measures itself with one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  // The buyer answered before: the banner stays closed, the button shows.
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
});

describe("SiteFrame", () => {
  it("puts the page in <main id=konten>, after the skip link and the header", () => {
    renderWithProviders(
      <SiteFrame>
        <p>Isi halaman</p>
      </SiteFrame>,
    );

    const main = screen.getByRole("main");
    expect(main.id).toBe("konten");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(within(main).getByText("Isi halaman")).toBeTruthy();
    expect(screen.getAllByRole("link")[0]?.getAttribute("href")).toBe(
      "#konten",
    );
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("has no footer and no analytics settings when analytics is off (the default)", () => {
    renderWithProviders(
      <SiteFrame>
        <p>Isi halaman</p>
      </SiteFrame>,
    );

    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pengaturan analytics" }),
    ).toBeNull();
  });

  it('adds a footer with "Pengaturan analytics" when analytics is on', async () => {
    renderWithProviders(
      <SiteFrame analytics>
        <p>Isi halaman</p>
      </SiteFrame>,
    );

    const footer = screen.getByRole("contentinfo");
    expect(
      await within(footer).findByRole("button", {
        name: "Pengaturan analytics",
      }),
    ).toBeTruthy();
    // After the page, never inside <main>.
    expect(screen.getByRole("main").contains(footer)).toBe(false);
  });
});
