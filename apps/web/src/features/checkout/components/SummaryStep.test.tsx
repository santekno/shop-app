import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CheckoutPreviewRequest } from "@goshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/features/auth/session-context.ts";
import {
  preview,
  previewResponse,
  problem,
  voucher,
} from "@/test/checkout-fixtures.ts";
import {
  cartLine,
  deferred,
  detailedErrorResponse,
  errorResponse,
  fetchMock,
  rupiah,
  user,
} from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import { previewQuery } from "../api/queries.ts";
import { SummaryStep } from "./SummaryStep.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };
const choice: CheckoutPreviewRequest = { address_id: "a1" };
const lines = [
  cartLine("v1", { product_name: "Kaos Polos", variant_name: "M" }),
];

/** SummaryStep as CheckoutPage uses it, starting with `initialVoucher`. */
function Harness({
  initialVoucher = null,
}: {
  initialVoucher?: string | null;
}) {
  const { authApi } = useSession();
  const [code, setCode] = useState<string | null>(initialVoucher);
  const current = useQuery(
    previewQuery(
      authApi,
      "u1",
      "sig",
      code === null ? choice : { ...choice, voucher_code: code },
    ),
  );
  return (
    <SummaryStep
      userId="u1"
      cartSignature="sig"
      cartLines={lines}
      choice={choice}
      voucherCode={code}
      onVoucherChange={setCode}
      preview={current}
    />
  );
}

const totalText = () =>
  document.querySelector(".order-total")?.textContent ?? null;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("SummaryStep", () => {
  it("says the total is being computed, then shows it with the voucher form", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    renderWithProviders(<Harness />, { session });

    expect(screen.getByRole("status").textContent).toBe("Menghitung total…");
    answer.resolve(previewResponse(preview(lines, { subtotal: 89_000 })));

    await waitFor(() => {
      expect(totalText()).toBe(rupiah(89_000));
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("form", { name: "Voucher" })).toBeTruthy();
  });

  it("shows the voucher in use from the preview, and prices without it after Hapus voucher", async () => {
    fetchMock.mockImplementation((_, init) => {
      const body = JSON.parse(String(init?.body)) as CheckoutPreviewRequest;
      return Promise.resolve(
        previewResponse(
          body.voucher_code === undefined
            ? preview(lines, { subtotal: 89_000 })
            : preview(lines, {
                subtotal: 89_000,
                discount: 15_000,
                voucher: voucher(),
              }),
        ),
      );
    });
    renderWithProviders(<Harness initialVoucher="POTONG15RB" />, { session });
    const user = userEvent.setup();

    const applied = await screen.findByText(/dipakai/);
    expect(applied.textContent).toBe(
      `Voucher POTONG15RB dipakai (${rupiah(15_000)}).`,
    );
    expect(applied.getAttribute("role")).toBe("status");
    expect(totalText()).toBe(rupiah(74_000));

    await user.click(screen.getByRole("button", { name: "Hapus voucher" }));

    await waitFor(() => {
      expect(totalText()).toBe(rupiah(89_000));
    });
    expect(screen.queryByText(/dipakai/)).toBeNull();
    expect(screen.getByRole("form", { name: "Voucher" })).toBeTruthy();
  });

  it("lists the refused lines for CHECKOUT_PROBLEMS, with no retry", async () => {
    fetchMock.mockResolvedValue(
      detailedErrorResponse(409, "CHECKOUT_PROBLEMS", {
        lines: [problem("v1", { problem: "insufficient_stock", available: 0 })],
      }),
    );
    renderWithProviders(<Harness />, { session });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Kaos Polos (M): stoknya habis. Hapus dari keranjang.",
    );
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
    expect(totalText()).toBeNull();
  });

  it("offers Hapus voucher when the voucher in use is refused, and prices without it", async () => {
    fetchMock.mockImplementation((_, init) => {
      const body = JSON.parse(String(init?.body)) as CheckoutPreviewRequest;
      return Promise.resolve(
        body.voucher_code === undefined
          ? previewResponse(preview(lines, { subtotal: 89_000 }))
          : detailedErrorResponse(409, "VOUCHER_NOT_APPLICABLE", {
              reason: "exhausted",
            }),
      );
    });
    renderWithProviders(<Harness initialVoucher="LAMA" />, { session });
    const user = userEvent.setup();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Kuota voucher ini sudah habis.");
    // The form would offer a second voucher next to the refused one.
    expect(screen.queryByRole("form", { name: "Voucher" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Hapus voucher" }));

    await waitFor(() => {
      expect(totalText()).toBe(rupiah(89_000));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("form", { name: "Voucher" })).toBeTruthy();
  });

  it("offers Coba lagi for any other error, and computes the total again", async () => {
    const retry = deferred<Response>();
    fetchMock.mockResolvedValueOnce(errorResponse(503, "UPSTREAM_UNAVAILABLE"));
    fetchMock.mockReturnValueOnce(retry.promise);
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Layanan ongkos kirim sedang tidak menjawab. Coba lagi sebentar lagi.Coba lagi",
    );
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Menghitung total…",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    retry.resolve(previewResponse(preview(lines, { subtotal: 89_000 })));
    await waitFor(() => {
      expect(totalText()).toBe(rupiah(89_000));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the last totals beside the error when a refetch fails, and says it is computing again", async () => {
    const retry = deferred<Response>();
    fetchMock.mockResolvedValueOnce(
      previewResponse(preview(lines, { subtotal: 89_000 })),
    );
    fetchMock.mockResolvedValueOnce(errorResponse(429, "RATE_LIMITED"));
    fetchMock.mockReturnValueOnce(retry.promise);
    const { queryClient } = renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();
    await waitFor(() => {
      expect(totalText()).toBe(rupiah(89_000));
    });

    // The cart changed elsewhere (usePlaceOrder invalidates the previews).
    await queryClient.invalidateQueries({ queryKey: ["checkout"] });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
    expect(totalText()).toBe(rupiah(89_000));
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Menghitung ulang total…",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      document.querySelector("[aria-busy]")?.getAttribute("aria-busy"),
    ).toBe("true");
    retry.resolve(previewResponse(preview(lines, { subtotal: 99_000 })));
    await waitFor(() => {
      expect(totalText()).toBe(rupiah(99_000));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
