import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  Address,
  Cart,
  CheckoutPreviewRequest,
  PaymentSession,
  ShippingQuote,
} from "@goshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStateFor } from "@/lib/navigation-state.ts";
import {
  address,
  addressesResponse,
  order,
  orderResponse,
  paymentResponse,
  paymentSession,
  preview,
  previewResponse,
  problem,
  quote,
  quotesResponse,
} from "@/test/checkout-fixtures.ts";
import {
  cartLine,
  cartOf,
  cartResponse,
  deferred,
  detailedErrorResponse,
  errorResponse,
  fetchMock,
  requestUrl,
  rupiah,
  user,
} from "@/test/fake-api.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { CheckoutPage } from "./CheckoutPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };

const kaos = cartLine("v1", {
  product_name: "Kaos Polos",
  variant_name: "M",
  sku: "KAOS-M",
  quantity: 2,
  unit_price: { amount: 89_000, currency: "IDR" },
});
const home = address("a1", { label: "Rumah", is_default: true });
const office = address("a2", { label: "Kantor" });
const jneReg = quote();
const jneYes = quote({
  service: "YES",
  service_name: "Yakin Esok Sampai",
  price: { amount: 30_000, currency: "IDR" },
  etd: "1 day",
});

type Answer = Response | Promise<Response>;

interface Api {
  cart: Cart;
  addresses: () => Answer;
  quotes: (addressId: string) => Answer;
  preview: (choice: CheckoutPreviewRequest) => Answer;
  checkout: () => Answer;
  pay: () => Answer;
}

/** The fake API for one checkout, every route overridable. */
const serveCheckout = (overrides: Partial<Api> = {}) => {
  const api: Api = {
    cart: cartOf([kaos]),
    addresses: () => addressesResponse([home, office]),
    quotes: () => quotesResponse([jneReg, jneYes]),
    preview: (choice) => {
      const fee =
        choice.service === "YES" ? 30_000 : choice.service ? 18_000 : 0;
      return previewResponse(
        preview([kaos], {
          subtotal: 178_000,
          shippingFee: fee,
          shipping:
            choice.service === undefined
              ? null
              : choice.service === "YES"
                ? jneYes
                : jneReg,
        }),
      );
    },
    checkout: () => orderResponse(order()),
    pay: () =>
      paymentResponse(
        paymentSession("order-1", {
          provider: "fake",
          redirect_url: "https://fake-payment.invalid/pay",
        }),
      ),
    ...overrides,
  };
  fetchMock.mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    switch (`${method} ${url.pathname}`) {
      case "GET /v1/cart":
        return cartResponse(api.cart);
      case "GET /v1/me/addresses":
        return api.addresses();
      case "GET /v1/checkout/shipping-quotes":
        return api.quotes(url.searchParams.get("address_id") ?? "");
      case "POST /v1/checkout/preview":
        return api.preview(
          JSON.parse(String(init?.body)) as CheckoutPreviewRequest,
        );
      case "POST /v1/checkout":
        return api.checkout();
      case "POST /v1/orders/order-1/pay":
        return api.pay();
      default:
        return errorResponse(404, "NOT_FOUND");
    }
  });
};

/** How many requests went to `method path`. */
const requests = (route: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      `${init?.method ?? "GET"} ${requestUrl(input).pathname}` === route,
  );

const bodies = (route: string) =>
  requests(route).map(([, init]) => JSON.parse(String(init?.body)) as unknown);

const gtag = vi.fn();
const events = () =>
  gtag.mock.calls.map(([, name, params]) => ({
    name: name as string,
    params: params as Record<string, unknown>,
  }));

const mount = () =>
  renderWithProviders(<CheckoutPage />, {
    url: ["/keranjang", "/checkout"],
    session,
  });

const placeButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: /Buat pesanan & bayar|Memproses pesanan…/,
  });

const blockedReason = () => {
  const id = placeButton().getAttribute("aria-describedby");
  return id === null ? null : document.getElementById(id)?.textContent;
};

const totalText = () =>
  document.querySelector(".order-total")?.textContent ?? null;

/** Waits for the quotes and picks one courier service. */
const pickCourier = async (
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) => {
  await user.click(await screen.findByRole("radio", { name }));
};

beforeEach(() => {
  fetchMock.mockReset();
  gtag.mockReset();
  window.gtag = gtag;
});

afterEach(() => {
  delete window.gtag;
});

describe("CheckoutPage", () => {
  it("says the cart is empty and asks for nothing else", async () => {
    serveCheckout({ cart: cartOf([]) });
    mount();

    const empty = await screen.findByText(/Keranjang Anda kosong\./);
    expect(empty.textContent).toBe(
      "Keranjang Anda kosong. Lihat produk untuk mulai belanja.",
    );
    expect(
      screen.getByRole("link", { name: "Lihat produk" }).getAttribute("href"),
    ).toBe("/");
    expect(
      screen.queryByRole("heading", { name: /Alamat pengiriman/ }),
    ).toBeNull();
    await waitFor(() => {
      expect(requests("GET /v1/me/addresses")).toHaveLength(1);
    });
    expect(requests("POST /v1/checkout/preview")).toHaveLength(0);
    expect(events()).toEqual([]);
  });

  it("chooses the default address, lists its couriers and waits for a courier", async () => {
    serveCheckout({ addresses: () => addressesResponse([office, home]) });
    mount();

    expect(screen.getByText("Memuat alamat…").getAttribute("role")).toBe(
      "status",
    );
    const rumah = await screen.findByRole<HTMLInputElement>("radio", {
      name: /Rumah/,
    });
    expect(rumah.checked).toBe(true);
    await screen.findByRole("radio", { name: /Reguler/ });
    expect(
      requests("GET /v1/checkout/shipping-quotes").map(([input]) =>
        requestUrl(input).searchParams.get("address_id"),
      ),
    ).toEqual(["a1"]);
    await waitFor(() => {
      expect(totalText()).toBe(rupiah(178_000));
    });
    // The first preview waited for the addresses: priced once, with the default.
    expect(bodies("POST /v1/checkout/preview")).toEqual([{ address_id: "a1" }]);
    expect(placeButton().disabled).toBe(true);
    expect(blockedReason()).toBe("Pilih alamat dan kurir dulu.");
  });

  it("sends begin_checkout once, with the cart's items", async () => {
    serveCheckout();
    const user = userEvent.setup();
    mount();

    await pickCourier(user, /Reguler/);
    await pickCourier(user, /Yakin Esok Sampai/);

    const begins = events().filter((event) => event.name === "begin_checkout");
    expect(begins).toHaveLength(1);
    expect(begins[0]?.params).toEqual({
      currency: "IDR",
      value: 178_000,
      items: [
        {
          item_id: "KAOS-M",
          item_name: "Kaos Polos",
          item_variant: "M",
          price: 89_000,
          quantity: 2,
        },
      ],
    });
  });

  it("prices the courier the buyer picks and sends add_shipping_info for each pick", async () => {
    serveCheckout();
    const user = userEvent.setup();
    mount();

    await pickCourier(user, /Yakin Esok Sampai/);

    await waitFor(() => {
      expect(totalText()).toBe(rupiah(208_000));
    });
    expect(bodies("POST /v1/checkout/preview")).toContainEqual({
      address_id: "a1",
      courier: "jne",
      service: "YES",
    });
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(totalText()).toBe(rupiah(196_000));
    });
    expect(
      events()
        .filter((event) => event.name === "add_shipping_info")
        .map((event) => event.params.shipping_tier),
    ).toEqual(["JNE YES", "JNE REG"]);
    expect(placeButton().disabled).toBe(false);
    expect(blockedReason()).toBeNull();
  });

  it("forgets the courier picked for another address", async () => {
    serveCheckout({
      quotes: (addressId) =>
        quotesResponse(addressId === "a2" ? [jneReg] : [jneReg, jneYes]),
    });
    const user = userEvent.setup();
    mount();
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(placeButton().disabled).toBe(false);
    });

    await user.click(screen.getByRole("radio", { name: /Kantor/ }));

    await waitFor(() => {
      expect(
        requests("GET /v1/checkout/shipping-quotes").map(([input]) =>
          requestUrl(input).searchParams.get("address_id"),
        ),
      ).toEqual(["a1", "a2"]);
    });
    const reg = await screen.findByRole<HTMLInputElement>("radio", {
      name: /Reguler/,
    });
    expect(reg.checked).toBe(false);
    expect(placeButton().disabled).toBe(true);
    expect(blockedReason()).toBe("Pilih alamat dan kurir dulu.");
  });

  it("keeps the button blocked, the last totals dimmed, until the new preview answers", async () => {
    const yes = deferred<Response>();
    serveCheckout({
      preview: (choice) =>
        choice.service === "YES"
          ? yes.promise
          : previewResponse(preview([kaos], { subtotal: 178_000 })),
    });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(totalText()).toBe(rupiah(178_000));
    });

    await pickCourier(user, /Yakin Esok Sampai/);

    expect(blockedReason()).toBe("Tunggu ringkasan pesanan selesai dihitung.");
    expect(
      document
        .querySelector("[aria-busy='true']")
        ?.querySelector(".order-total")?.textContent,
    ).toBe(rupiah(178_000));
    yes.resolve(
      previewResponse(
        preview([kaos], {
          subtotal: 178_000,
          shippingFee: 30_000,
          shipping: jneYes,
        }),
      ),
    );
    await waitFor(() => {
      expect(placeButton().disabled).toBe(false);
    });
    expect(totalText()).toBe(rupiah(208_000));
  });

  it("shows a failed address list with Coba lagi, which loads it", async () => {
    let attempts = 0;
    serveCheckout({
      addresses: () => {
        attempts += 1;
        return attempts === 1
          ? errorResponse(429, "RATE_LIMITED")
          : addressesResponse([home]);
      },
    });
    const user = userEvent.setup();
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    expect(
      (await screen.findByRole<HTMLInputElement>("radio", { name: /Rumah/ }))
        .checked,
    ).toBe(true);
  });

  it("asks a buyer without an address to add one before the couriers", async () => {
    serveCheckout({ addresses: () => addressesResponse([]) });
    mount();

    expect(
      await screen.findByRole("heading", {
        name: "Tambahkan alamat pengiriman",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Pilih atau tambahkan alamat dulu.")).toBeTruthy();
    await waitFor(() => {
      expect(bodies("POST /v1/checkout/preview")).toEqual([{}]);
    });
    expect(requests("GET /v1/checkout/shipping-quotes")).toHaveLength(0);
  });

  it("shows the quotes' failure with Coba lagi, which asks again", async () => {
    let attempts = 0;
    serveCheckout({
      quotes: () => {
        attempts += 1;
        return attempts === 1
          ? errorResponse(503, "UPSTREAM_UNAVAILABLE")
          : quotesResponse([jneReg]);
      },
    });
    const user = userEvent.setup();
    mount();

    const message = await screen.findByText(
      "Layanan ongkos kirim sedang tidak menjawab. Coba lagi sebentar lagi.",
    );
    await user.click(
      within(message.parentElement ?? document.body).getByRole("button", {
        name: "Coba lagi",
      }),
    );

    expect(await screen.findByRole("radio", { name: /Reguler/ })).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("places the order with the chosen body, shows it, and opens the test gateway's payment page", async () => {
    const pay = deferred<Response>();
    serveCheckout({ pay: () => pay.promise });
    const user = userEvent.setup();
    mount();
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(placeButton().disabled).toBe(false);
    });

    await user.click(placeButton());

    expect(
      (await screen.findByText(/sudah dibuat/)).textContent?.replace(
        / {2,}|\n/g,
        " ",
      ),
    ).toBe(
      `Pesanan GS-20261030-7KQ2M9 (${rupiah(107_000)}) sudah dibuat. Membuka pembayaran…`,
    );
    expect(bodies("POST /v1/checkout")).toEqual([
      { address_id: "a1", courier: "jne", service: "REG" },
    ]);
    const previewsBefore = requests("POST /v1/checkout/preview").length;
    pay.resolve(
      paymentResponse(
        paymentSession("order-1", {
          provider: "fake",
          redirect_url: "https://fake-payment.invalid/pay",
        }),
      ),
    );

    await waitFor(() => {
      expect(currentLocation()).toBe("/pesanan/order-1/pembayaran");
    });
    expect(navigationStateFor("/pesanan/order-1/pembayaran")).toEqual({
      fakeProvider: true,
    });
    // Replaced: Back does not return to the emptied checkout.
    expect(screen.queryByRole("button")).toBeNull();
    // The order exists: no new preview of the emptied cart.
    expect(requests("POST /v1/checkout/preview")).toHaveLength(previewsBefore);
    expect(
      events()
        .filter((event) => event.name === "add_payment_info")
        .map((event) => event.params.payment_type),
    ).toEqual(["fake_gateway"]);
  });

  it("replaces the entry with the payment page before sending the buyer to Midtrans", async () => {
    serveCheckout({ pay: () => paymentResponse(paymentSession("order-1")) });
    // window.location.assign(redirect_url) follows; jsdom cannot leave the
    // document (it prints "Not implemented: navigation"), and its location
    // cannot be spied on, so the URL itself is usePayOrder's test's to check.
    const user = userEvent.setup();
    const { router } = mount();
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(placeButton().disabled).toBe(false);
    });

    await user.click(placeButton());

    await waitFor(() => {
      expect(window.location.pathname).toBe("/pesanan/order-1/pembayaran");
    });
    expect(router.entries).toEqual(["/keranjang", "/checkout"]);
    expect(
      JSON.parse(window.sessionStorage.getItem("goshop:payment-return") ?? ""),
    ).toEqual({ orderId: "order-1", code: "GS-20261030-7KQ2M9" });
    expect(
      events()
        .filter((event) => event.name === "add_payment_info")
        .map((event) => event.params.payment_type),
    ).toEqual(["midtrans_snap"]);
  });

  it.each<[string, () => Answer, string]>([
    [
      "a redirect_url that is not Midtrans",
      () =>
        paymentResponse(
          paymentSession("order-1", {
            redirect_url: "https://midtrans.com.evil.example/pay",
          } satisfies Partial<PaymentSession>),
        ),
      "Halaman pembayaran yang diterima tidak valid. Coba lagi, atau hubungi kami bila terus terjadi.",
    ],
    [
      "PAYMENTS_DISABLED",
      () => errorResponse(503, "PAYMENTS_DISABLED"),
      "Pembayaran sedang tidak tersedia di toko ini. Coba lagi nanti.",
    ],
  ])(
    "still opens the order's payment page, with the reason, after %s",
    async (_, pay, reason) => {
      serveCheckout({ pay });
      const user = userEvent.setup();
      const { router } = mount();
      await pickCourier(user, /Reguler/);
      await waitFor(() => {
        expect(placeButton().disabled).toBe(false);
      });

      await user.click(placeButton());

      await waitFor(() => {
        expect(currentLocation()).toBe("/pesanan/order-1/pembayaran");
      });
      expect(router.lastAction).toBe("replace");
      expect(navigationStateFor("/pesanan/order-1/pembayaran")).toEqual({
        payError: reason,
      });
      expect(window.sessionStorage.getItem("goshop:payment-return")).toBeNull();
    },
  );

  it("sends one order for a double press", async () => {
    const placed = deferred<Response>();
    serveCheckout({ checkout: () => placed.promise });
    const user = userEvent.setup();
    mount();
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(placeButton().disabled).toBe(false);
    });

    await user.dblClick(placeButton());

    expect(placeButton().textContent).toBe("Memproses pesanan…");
    expect(placeButton().disabled).toBe(true);
    expect(requests("POST /v1/checkout")).toHaveLength(1);
    placed.resolve(orderResponse(order()));
    await screen.findByText(/sudah dibuat/);
    expect(requests("POST /v1/checkout")).toHaveLength(1);
  });

  it("lists the refused lines and fetches the cart and the preview again after CHECKOUT_PROBLEMS", async () => {
    serveCheckout({
      checkout: () =>
        detailedErrorResponse(409, "CHECKOUT_PROBLEMS", {
          lines: [problem("v1", { sku: "KAOS-M" })],
        }),
    });
    const user = userEvent.setup();
    mount();
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(placeButton().disabled).toBe(false);
    });
    const carts = requests("GET /v1/cart").length;
    const previews = requests("POST /v1/checkout/preview").length;

    await user.click(placeButton());

    expect((await screen.findByText(/sudah tidak dijual/)).textContent).toBe(
      "Kaos Polos (M): sudah tidak dijual. Hapus dari keranjang.",
    );
    await waitFor(() => {
      expect(requests("GET /v1/cart").length).toBe(carts + 1);
    });
    expect(requests("POST /v1/checkout/preview").length).toBe(previews + 1);
    expect(requests("POST /v1/orders/order-1/pay")).toHaveLength(0);
    expect(currentLocation()).toBe("/checkout");
  });

  it("says why the order was refused, focused, and stays on the page", async () => {
    serveCheckout({
      checkout: () => errorResponse(403, "EMAIL_UNVERIFIED"),
    });
    const user = userEvent.setup();
    mount();
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(placeButton().disabled).toBe(false);
    });

    await user.click(placeButton());

    const alert = await screen.findByText(
      "Verifikasi email Anda dulu sebelum membuat pesanan. Buka tautan verifikasi yang kami kirim ke email Anda.",
    );
    expect(alert.getAttribute("role")).toBe("alert");
    await waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
    expect(placeButton().disabled).toBe(false);
    expect(currentLocation()).toBe("/checkout");
  });

  it("adds the voucher to the order and to add_shipping_info", async () => {
    serveCheckout({
      preview: (choice) =>
        previewResponse(
          preview([kaos], {
            subtotal: 178_000,
            discount: choice.voucher_code === undefined ? 0 : 15_000,
            shippingFee: choice.service === undefined ? 0 : 18_000,
            shipping: choice.service === undefined ? null : jneReg,
            voucher:
              choice.voucher_code === undefined
                ? null
                : {
                    code: choice.voucher_code,
                    kind: "fixed",
                    value: 15_000,
                    max_discount: null,
                  },
          }),
        ),
    });
    const user = userEvent.setup();
    mount();
    await screen.findByRole("radio", { name: /Reguler/ });

    await user.type(
      screen.getByRole("textbox", { name: "Kode voucher" }),
      "potong15rb",
    );
    await user.click(screen.getByRole("button", { name: "Pakai" }));
    await screen.findByText(/dipakai/);
    await pickCourier(user, /Reguler/);
    await waitFor(() => {
      expect(totalText()).toBe(rupiah(181_000));
    });
    await user.click(placeButton());

    await waitFor(() => {
      expect(bodies("POST /v1/checkout")).toEqual([
        {
          address_id: "a1",
          courier: "jne",
          service: "REG",
          voucher_code: "POTONG15RB",
        },
      ]);
    });
    expect(
      events().find((event) => event.name === "add_shipping_info")?.params
        .coupon,
    ).toBe("POTONG15RB");
  });
});
