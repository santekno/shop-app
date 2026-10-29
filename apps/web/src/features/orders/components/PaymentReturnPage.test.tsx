import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMock } from "@/test/fake-api.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { rememberPaymentReturn } from "../payment-state.ts";
import { PaymentReturnPage } from "./PaymentReturnPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const RETURN = "/pembayaran/selesai";

const mount = (query: string) =>
  renderWithProviders(<PaymentReturnPage />, {
    path: RETURN,
    url: ["/pesanan/order-1/pembayaran", `${RETURN}?${query}`],
  });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("PaymentReturnPage", () => {
  it("goes on to the remembered order's payment page, replacing the return URL", async () => {
    rememberPaymentReturn({ orderId: "order-1", code: "GS-20261030-7KQ2M9" });

    const { router } = mount(
      "order_id=GS-20261030-7KQ2M9-K3D9QX&status_code=200&transaction_status=settlement",
    );

    await waitFor(() => {
      expect(currentLocation()).toBe("/pesanan/order-1/pembayaran");
    });
    expect(router.lastAction).toBe("replace");
    expect(router.entries).toEqual([
      "/pesanan/order-1/pembayaran",
      "/pesanan/order-1/pembayaran",
    ]);
    // It asks nobody, and trusts no status from the URL: the payment page
    // asks the API.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/diterima|berhasil|lunas/i)).toBeNull();
  });

  it.each([
    [
      "a forged settlement for another order",
      "order_id=GS-20261030-AAAAAA-K3D9QX&status_code=200&transaction_status=settlement",
    ],
    [
      "a settlement without order_id",
      "status_code=200&transaction_status=settlement",
    ],
  ])("goes nowhere for %s", async (_, query) => {
    rememberPaymentReturn({ orderId: "order-1", code: "GS-20261030-7KQ2M9" });

    const { router } = mount(query);

    expect(screen.getByRole("heading", { name: "Pembayaran" })).toBeDefined();
    await Promise.resolve();
    expect(router.lastAction).toBe("start");
    expect(currentLocation()).toBe(`${RETURN}?${query}`);
    expect(screen.queryByText(/diterima/)).toBeNull();
  });

  it("says where to look when nothing was remembered (another tab, blocked storage)", () => {
    const { router } = mount(
      "order_id=GS-20261030-7KQ2M9-K3D9QX&status_code=200&transaction_status=settlement",
    );

    expect(
      screen.getByText(/Terima kasih\./).textContent.replace(/\s+/g, " "),
    ).toBe(
      "Terima kasih. Status pembayaran Anda diperbarui begitu GoShop menerima konfirmasi dari Midtrans; Anda juga akan mendapat email.",
    );
    expect(
      screen
        .getByRole("link", { name: "Lihat pesanan saya" })
        .getAttribute("href"),
    ).toBe("/pesanan");
    expect(router.lastAction).toBe("start");
  });
});
