import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { quietEventsHandler } from "@/test/msw/events.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoutes } from "@/test/render.tsx";
import { session } from "@/test/fixtures.ts";
import { DashboardLayout } from "./DashboardLayout.tsx";
import { NAV_ITEMS } from "./navigation.ts";

const page = (title: string) => <h1 tabIndex={-1}>{title}</h1>;

const renderLayout = (url = "/") => {
  server.use(quietEventsHandler());
  return renderRoutes(
    [
      {
        path: "/",
        element: <DashboardLayout />,
        handle: { crumb: "Dasbor" },
        children: [
          {
            index: true,
            element: page("Ringkasan"),
            handle: { crumb: "Ringkasan" },
          },
          {
            path: "produk",
            element: page("Produk"),
            handle: { crumb: "Produk" },
          },
          {
            path: "pesanan",
            element: page("Pesanan"),
            handle: { crumb: "Pesanan" },
          },
          {
            path: "laporan",
            element: page("Laporan"),
            handle: { crumb: "Laporan" },
          },
        ],
      },
      { path: "/luar", element: <Outlet /> },
    ],
    { url, session: session("admin", "t", { name: "Rina" }) },
  );
};

describe("NAV_ITEMS", () => {
  it("lists the four sections in order, only Ringkasan matching its path exactly", () => {
    expect(
      NAV_ITEMS.map(({ to, label, end }) => [to, label, end === true]),
    ).toEqual([
      ["/", "Ringkasan", true],
      ["/produk", "Produk", false],
      ["/pesanan", "Pesanan", false],
      ["/laporan", "Laporan", false],
    ]);
  });
});

describe("DashboardLayout", () => {
  it("has the skip link first, then the banner, the menu and the main content", async () => {
    renderLayout("/produk");
    await screen.findByText("Langsung");

    const landmarks = [
      screen.getByRole("link", { name: "Langsung ke konten utama" }),
      screen.getByRole("banner"),
      screen.getByRole("navigation", { name: "Menu utama" }),
      screen.getByRole("main"),
    ];
    for (let i = 1; i < landmarks.length; i++) {
      const before = landmarks[i - 1];
      const after = landmarks[i];
      if (before === undefined || after === undefined)
        throw new Error("landmark");
      expect(
        before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "konten");
    expect(
      within(main).getByRole("heading", { level: 1, name: "Produk" }),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole("navigation", { name: "Jejak navigasi" }),
    ).toHaveTextContent("DasborProduk");
  });

  it("marks the page on screen in the menu, Ringkasan only on /", async () => {
    renderLayout("/pesanan");
    const nav = screen.getByRole("navigation", { name: "Menu utama" });
    await screen.findByText("Langsung");

    expect(within(nav).getByRole("link", { name: "Pesanan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(nav).getByRole("link", { name: "Ringkasan" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("names the app and the user in the banner, with the live status", async () => {
    renderLayout();
    const banner = screen.getByRole("banner");

    expect(
      within(banner).getByRole("link", { name: "GoShop Admin" }),
    ).toHaveAttribute("href", "/");
    expect(
      within(banner).getByRole("button", { name: /Rina/ }),
    ).toBeInTheDocument();
    expect(await within(banner).findByText("Langsung")).toBeInTheDocument();
  });

  it("opens and closes the phone menu with its disclosure button", async () => {
    const user = userEvent.setup();
    renderLayout();
    await screen.findByText("Langsung");
    const button = screen.getByRole("button", { name: "Menu" });
    const nav = screen.getByRole("navigation", { name: "Menu utama" });

    expect(button).toHaveAttribute("aria-controls", "navigasi-utama");
    expect(nav).toHaveAttribute("id", "navigasi-utama");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(nav).toHaveClass("hidden");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(nav).toHaveClass("block");
    expect(nav).not.toHaveClass("hidden");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("folds the phone menu when a link is followed", async () => {
    const user = userEvent.setup();
    const { router } = renderLayout();
    await screen.findByText("Langsung");
    const button = screen.getByRole("button", { name: "Menu" });
    await user.click(button);

    await user.click(
      within(screen.getByRole("navigation", { name: "Menu utama" })).getByRole(
        "link",
        {
          name: "Laporan",
        },
      ),
    );

    expect(router.state.location.pathname).toBe("/laporan");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
