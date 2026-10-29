import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { apiError, quote } from "@/test/checkout-fixtures.ts";
import { rupiah } from "@/test/fake-api.ts";
import { CourierStep } from "./CourierStep.tsx";

const jneReg = quote();
const jneYes = quote({
  service: "YES",
  service_name: "Yakin Esok Sampai",
  price: { amount: 30_000, currency: "IDR" },
  etd: "1 day",
});

const step = (props: Partial<ComponentProps<typeof CourierStep>> = {}) => {
  const onSelect = vi.fn();
  const onRetry = vi.fn();
  render(
    <CourierStep
      hasAddress
      quotes={[jneReg, jneYes]}
      loading={false}
      error={null}
      onRetry={onRetry}
      selected={null}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect, onRetry };
};

describe("CourierStep", () => {
  it("asks for an address first", () => {
    step({ hasAddress: false });
    expect(screen.getByText("Pilih atau tambahkan alamat dulu.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("says the fees are being computed while the quotes load", () => {
    step({ loading: true });
    expect(screen.getByRole("status").textContent).toBe(
      "Menghitung ongkos kirim…",
    );
  });

  it("lists each service with its price and the estimate in Indonesian", () => {
    step({ selected: { addressId: "a1", courier: "jne", service: "YES" } });

    const radios = screen.getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual([
      `JNE RegulerEstimasi 2-3 hari${rupiah(18_000)}`,
      `JNE Yakin Esok SampaiEstimasi 1 hari${rupiah(30_000)}`,
    ]);
    const [reg, yes] = radios;
    expect(reg?.checked).toBe(false);
    expect(yes?.checked).toBe(true);
  });

  it("hands the picked quote to onSelect", async () => {
    const { onSelect } = step();
    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: /Yakin Esok Sampai/ }));
    expect(onSelect).toHaveBeenCalledWith(jneYes);
  });

  it.each([[undefined], [[]]])(
    "says no courier serves the address when the quotes are %j",
    (quotes) => {
      step({ quotes });
      expect(
        screen.getByText(
          "Belum ada kurir untuk alamat ini. Pilih alamat lain.",
        ),
      ).toBeTruthy();
    },
  );

  it("offers a retry when the rates service did not answer", async () => {
    const { onRetry } = step({ error: apiError(503, "UPSTREAM_UNAVAILABLE") });

    expect(screen.getByRole("alert").textContent).toContain(
      "Layanan ongkos kirim sedang tidak menjawab. Coba lagi sebentar lagi.",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "SHIPPING_UNAVAILABLE",
      "Tidak ada kurir yang melayani kode pos alamat ini. Pilih atau tambahkan alamat lain.",
    ],
    ["CART_EMPTY", "Keranjang Anda kosong. Tambahkan barang dulu."],
    [
      "VALIDATION_FAILED",
      "Alamat atau layanan kurir yang dipilih sudah tidak berlaku. Pilih lagi.",
    ],
  ])("offers no retry for %s, which retrying does not fix", (code, text) => {
    step({ error: apiError(422, code) });

    expect(screen.getByRole("alert").textContent).toBe(text);
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });
});
