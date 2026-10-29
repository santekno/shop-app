import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AppliedVoucher, CheckoutPreviewRequest } from "@goshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/features/auth/session-context.ts";
import { preview, previewResponse, voucher } from "@/test/checkout-fixtures.ts";
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
import { VoucherForm } from "./VoucherForm.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };
const choice: CheckoutPreviewRequest = {
  address_id: "a1",
  courier: "jne",
  service: "REG",
};

/** The vouchers the fake API knows. */
const VOUCHERS: Record<string, AppliedVoucher> = {
  POTONG15RB: voucher(),
  HEMAT10: voucher({
    code: "HEMAT10",
    kind: "percent",
    value: 10,
    max_discount: { amount: 25_000, currency: "IDR" },
  }),
  DISKON5: voucher({
    code: "DISKON5",
    kind: "percent",
    value: 5,
    max_discount: null,
  }),
};

/** VoucherForm as SummaryStep uses it: `applied` comes from the preview. */
function Harness() {
  const { authApi } = useSession();
  const [code, setCode] = useState<string | null>(null);
  const current = useQuery(
    previewQuery(
      authApi,
      "u1",
      "sig",
      code === null ? choice : { ...choice, voucher_code: code },
    ),
  );
  return (
    <VoucherForm
      userId="u1"
      cartSignature="sig"
      choice={choice}
      applied={code === null ? null : (current.data?.voucher ?? null)}
      onApply={setCode}
      onRemove={() => {
        setCode(null);
      }}
    />
  );
}

/** Every preview body sent. */
const previews = () =>
  fetchMock.mock.calls.map(
    ([, init]) => JSON.parse(String(init?.body)) as CheckoutPreviewRequest,
  );

const serveVouchers = () => {
  fetchMock.mockImplementation((_, init) => {
    const body = JSON.parse(String(init?.body)) as CheckoutPreviewRequest;
    const code = body.voucher_code;
    if (code === undefined) {
      return Promise.resolve(previewResponse(preview([cartLine("v1")])));
    }
    const known = VOUCHERS[code];
    if (known === undefined) {
      return Promise.resolve(
        detailedErrorResponse(409, "VOUCHER_NOT_APPLICABLE", {
          reason: code === "HABIS" ? "exhausted" : "not_found",
        }),
      );
    }
    return Promise.resolve(
      previewResponse(preview([cartLine("v1")], { voucher: known })),
    );
  });
};

const mount = async () => {
  renderWithProviders(<Harness />, { session });
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  return userEvent.setup();
};

const field = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: "Kode voucher" });

const fieldError = () =>
  document.querySelector(".field__error")?.textContent ?? null;

beforeEach(() => {
  fetchMock.mockReset();
  serveVouchers();
});

describe("VoucherForm", () => {
  it("asks the API with the code in capitals, then shows it applied and focused, with no second request", async () => {
    const user = await mount();

    await user.type(field(), "potong15rb");
    await user.click(screen.getByRole("button", { name: "Pakai" }));

    const confirmation = await screen.findByRole("status");
    expect(confirmation.textContent).toBe(
      `Voucher POTONG15RB dipakai (${rupiah(15_000)}).`,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmation);
    });
    expect(previews()).toEqual([
      choice,
      { ...choice, voucher_code: "POTONG15RB" },
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each([
    ["HEMAT10", `10%, maks. ${rupiah(25_000)}`],
    ["DISKON5", "5%"],
  ])("describes the percent voucher %s", async (code, value) => {
    const user = await mount();

    await user.type(field(), code);
    await user.click(screen.getByRole("button", { name: "Pakai" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      `Voucher ${code} dipakai (${value}).`,
    );
  });

  it("brings the empty field back, focused, after Hapus voucher", async () => {
    const user = await mount();
    await user.type(field(), "POTONG15RB");
    await user.click(screen.getByRole("button", { name: "Pakai" }));
    await screen.findByRole("status");

    await user.click(screen.getByRole("button", { name: "Hapus voucher" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    expect(field().value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["HABIS", "Kuota voucher ini sudah habis."],
    ["SALAH", "Kode voucher tidak ditemukan."],
  ])(
    "keeps a refused code %s in the field with its reason, focused",
    async (code, reason) => {
      const user = await mount();

      await user.type(field(), code);
      await user.click(screen.getByRole("button", { name: "Pakai" }));

      await waitFor(() => {
        expect(fieldError()).toBe(reason);
      });
      expect(field().value).toBe(code);
      expect(field().getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(field());
      expect(screen.queryByRole("status")).toBeNull();
    },
  );

  it("shows any other failure above the form", async () => {
    const user = await mount();
    fetchMock.mockResolvedValue(errorResponse(429, "RATE_LIMITED"));

    await user.type(field(), "POTONG15RB");
    await user.click(screen.getByRole("button", { name: "Pakai" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
    expect(fieldError()).toBeNull();
    expect(field().value).toBe("POTONG15RB");
  });

  it.each([
    ["", "Masukkan kode voucher."],
    ["AB", "Kode voucher paling sedikit 3 karakter."],
    ["A".repeat(33), "Kode voucher paling panjang 32 karakter."],
    ["HEMAT-10", "Kode voucher hanya berisi huruf dan angka."],
  ])("refuses %j before asking the API", async (code, message) => {
    const user = await mount();

    if (code !== "") await user.type(field(), code);
    await user.click(screen.getByRole("button", { name: "Pakai" }));

    await waitFor(() => {
      expect(fieldError()).toBe(message);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says Memeriksa… and cannot be sent twice while the API checks", async () => {
    const user = await mount();
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);

    await user.type(field(), "POTONG15RB");
    await user.click(screen.getByRole("button", { name: "Pakai" }));
    const checking = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Memeriksa…",
    });
    expect(checking.disabled).toBe(true);
    await user.type(field(), "{Enter}");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    answer.resolve(
      previewResponse(preview([cartLine("v1")], { voucher: voucher() })),
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "POTONG15RB",
    );
  });
});
