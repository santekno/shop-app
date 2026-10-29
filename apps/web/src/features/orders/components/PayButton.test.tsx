import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  order,
  paymentResponse,
  paymentSession,
} from "@/test/checkout-fixtures.ts";
import {
  deferred,
  errorResponse,
  fetchMock,
  requestUrl,
  user,
} from "@/test/fake-api.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { stubLocation } from "@/test/window-location.ts";
import { PayButton } from "./PayButton.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };

const pays = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/orders/order-1/pay",
  );

const mount = (replace?: boolean, children?: string) =>
  renderWithProviders(
    <PayButton order={order()} replace={replace}>
      {children}
    </PayButton>,
    { url: "/pesanan/order-1", session },
  );

beforeEach(() => {
  fetchMock.mockReset();
});

describe("PayButton", () => {
  it("says 'Bayar sekarang' unless told otherwise", () => {
    mount();

    expect(screen.getByRole("button").textContent).toBe("Bayar sekarang");
  });

  it("is disabled while the payment starts, so a double click sends one request", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    const location = stubLocation();
    const clicker = userEvent.setup();
    mount(false, "Coba bayar lagi");

    await clicker.dblClick(screen.getByRole("button"));

    const button = screen.getByRole<HTMLButtonElement>("button");
    expect(button.textContent).toBe("Membuka pembayaran…");
    expect(button.disabled).toBe(true);
    expect(pays()).toHaveLength(1);
    answer.resolve(paymentResponse(paymentSession("order-1")));
    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(
        "https://app.sandbox.midtrans.com/snap/v4/redirection/abc",
      );
    });
  });

  it("opens the payment page in place of the current one with replace", async () => {
    fetchMock.mockResolvedValue(
      paymentResponse(
        paymentSession("order-1", {
          provider: "fake",
          redirect_url: "https://fake-payment.invalid/pay",
        }),
      ),
    );
    const clicker = userEvent.setup();
    const { router } = mount(true);

    await clicker.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(currentLocation()).toBe("/pesanan/order-1/pembayaran");
    });
    expect(router.lastAction).toBe("replace");
  });

  it("shows why the payment could not start, takes the focus, and lets the buyer try again", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503, "PAYMENTS_DISABLED"));
    const clicker = userEvent.setup();
    mount();

    await clicker.click(screen.getByRole("button"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Pembayaran sedang tidak tersedia di toko ini. Coba lagi nanti.",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
    const button = screen.getByRole<HTMLButtonElement>("button");
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Bayar sekarang");
    expect(currentLocation()).toBe("/pesanan/order-1");

    fetchMock.mockResolvedValueOnce(
      errorResponse(409, "PAYMENT_WINDOW_CLOSED"),
    );
    await clicker.click(button);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Batas waktu pembayaran pesanan ini sudah terlalu dekat, jadi pembayaran tidak bisa dimulai lagi.",
      );
    });
    expect(pays()).toHaveLength(2);
  });
});
