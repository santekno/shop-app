import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Text } from "react-native";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";

import { dismissNotice, useNotice } from "@/lib/notice";
import { fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { getAccessToken } from "../auth-seam";
import { WishlistButton } from "./WishlistButton";

jest.mock("../auth-seam", () => ({ getAccessToken: jest.fn(() => null) }));

function NoticeProbe() {
  const notice = useNotice();
  return notice === null ? null : <Text>{notice.message}</Text>;
}

afterEach(() => {
  jest.mocked(getAccessToken).mockReturnValue(null);
  dismissNotice();
});

describe("WishlistButton, signed out", () => {
  it("offers to save, as a button that is not selected", async () => {
    await renderWithProviders(
      <WishlistButton slug="kaos" productName="Kaos Polos" />,
    );

    const button = screen.getByRole("button", {
      name: "Simpan Kaos Polos ke wishlist",
    });
    expect(button).toHaveProp("accessibilityState", {
      selected: false,
      checked: false,
    });
    expect(button).toHaveProp("hitSlop", 6);
  });

  it("answers a tap with 'Masuk dulu' and sends nothing", async () => {
    await renderWithProviders(
      <>
        <WishlistButton slug="kaos" productName="Kaos Polos" />
        <NoticeProbe />
      </>,
    );

    await userEvent.press(
      screen.getByRole("button", { name: "Simpan Kaos Polos ke wishlist" }),
    );

    expect(
      await screen.findByText("Masuk dulu untuk menyimpan wishlist"),
    ).toBeTruthy();
    expect(fakeApi.requests()).toHaveLength(0);
  });
});

describe("WishlistButton, signed in", () => {
  it("is selected and offers removal when the product is saved", async () => {
    jest.mocked(getAccessToken).mockReturnValue("t");
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage([product("Kaos Polos")])),
    );
    await renderWithProviders(
      <WishlistButton slug="kaos-polos" productName="Kaos Polos" />,
    );

    const button = await screen.findByRole("button", {
      name: "Hapus Kaos Polos dari wishlist",
    });
    expect(button).toHaveProp("accessibilityState", {
      selected: true,
      checked: true,
    });
  });

  it("a tap saves the product and the label turns around", async () => {
    jest.mocked(getAccessToken).mockReturnValue("t");
    let saved: string[] = [];
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage(saved.map((n) => product(n)))),
    );
    fakeApi.on("PUT", "/v1/me/wishlist/kaos-polos", () => {
      saved = ["Kaos Polos"];
      return new Response(null, { status: 204 });
    });
    await renderWithProviders(
      <WishlistButton slug="kaos-polos" productName="Kaos Polos" />,
    );
    await waitFor(() => {
      expect(fakeApi.requests("GET", "/v1/me/wishlist")).toHaveLength(1);
    });

    await userEvent.press(
      screen.getByRole("button", { name: "Simpan Kaos Polos ke wishlist" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Hapus Kaos Polos dari wishlist",
      }),
    ).toBeTruthy();
    await act(async () => {
      await waitFor(() => {
        expect(
          fakeApi.requests("PUT", "/v1/me/wishlist/kaos-polos"),
        ).toHaveLength(1);
      });
    });
  });
});
