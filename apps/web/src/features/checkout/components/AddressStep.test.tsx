import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "@goshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/features/auth/session-context.ts";
import {
  address,
  addressResponse,
  addressesResponse,
  jsonBody,
} from "@/test/checkout-fixtures.ts";
import {
  detailedErrorResponse,
  errorResponse,
  fetchMock,
  user,
  validationResponse,
} from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import { chosenAddressId } from "../shipping.ts";
import { addressesQuery } from "../api/queries.ts";
import { AddressStep } from "./AddressStep.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };

const home = address("a1", {
  label: "Rumah",
  is_default: true,
  street: "Jl. Merdeka 1",
});
const office = address("a2", { label: "Kantor", street: "Jl. Asia Afrika 8" });

/** AddressStep the way CheckoutPage uses it: the list from the API, the pick in state. */
function Harness() {
  const { authApi } = useSession();
  const addresses = useQuery(addressesQuery(authApi, "u1"));
  const [picked, setPicked] = useState<string | null>(null);
  if (addresses.data === undefined) return null;
  return (
    <AddressStep
      userId="u1"
      addresses={addresses.data}
      selectedId={chosenAddressId(addresses.data, picked)}
      onSelect={setPicked}
    />
  );
}

/** Serves the list (`lists` in turn, the last one repeated) and POST. */
const serveAddresses = (
  lists: Address[][],
  post: () => Response = () => addressResponse(office),
) => {
  let served = 0;
  fetchMock.mockImplementation((_, init) => {
    if (init?.method === "POST") return Promise.resolve(post());
    const list = lists[Math.min(served, lists.length - 1)] ?? [];
    served += 1;
    return Promise.resolve(addressesResponse(list));
  });
};

const fillForm = async (
  user: UserEvent,
  values: Partial<Record<string, string>> = {},
) => {
  const form = screen.getByRole("form", { name: "Alamat baru" });
  const field = (label: string) => within(form).getByLabelText(label);
  const type = async (label: string, value: string) => {
    await user.clear(field(label));
    if (value !== "") await user.type(field(label), value);
  };
  await type("Nama alamat", values.label ?? "Kantor");
  await type("Nama penerima", values.recipient ?? "Budi Santoso");
  await type("Nomor telepon", values.phone ?? "0812-3456 7890");
  await type("Alamat lengkap", values.street ?? "Jl. Asia Afrika 8");
  await type("Kota atau kabupaten", values.city ?? "Bandung");
  await type("Provinsi", values.province ?? "Jawa Barat");
  await type("Kode pos", values.postal ?? "40111");
};

const posted = () => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  return call === undefined ? undefined : jsonBody(call[1]);
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("AddressStep", () => {
  it("lists every address with the default checked and marked Utama", async () => {
    serveAddresses([[home, office]]);
    renderWithProviders(<Harness />, { session });

    const group = await screen.findByRole("group", {
      name: "Pilih alamat pengiriman",
    });
    const radios = within(group).getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual([
      "RumahUtamaBudi Santoso · 081234567890Jl. Merdeka 1, Bandung, Jawa Barat 40111",
      "KantorBudi Santoso · 081234567890Jl. Asia Afrika 8, Bandung, Jawa Barat 40111",
    ]);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("checks the address the buyer picks", async () => {
    serveAddresses([[home, office]]);
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("radio", { name: /Kantor/ }));

    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: /Kantor/ }).checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: /Rumah/ }).checked,
    ).toBe(false);
  });

  it("shows the form at once, without Batal, to a buyer with no address", async () => {
    serveAddresses([[]]);
    renderWithProviders(<Harness />, { session });

    expect(
      await screen.findByRole("heading", {
        name: "Tambahkan alamat pengiriman",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Nama alamat" })
        .value,
    ).toBe("Rumah");
    expect(screen.queryByRole("button", { name: "Batal" })).toBeNull();
    expect(screen.queryByLabelText("Jadikan alamat utama")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("saves the first address as the default, cleaned, and selects it", async () => {
    const created = address("a9", { label: "Rumah", is_default: true });
    serveAddresses([[], [created]], () => addressResponse(created));
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();
    await screen.findByRole("form", { name: "Alamat baru" });

    await fillForm(user, { label: "Rumah" });
    await user.click(screen.getByRole("button", { name: "Simpan alamat" }));

    const radio = await screen.findByRole<HTMLInputElement>("radio", {
      name: /Rumah/,
    });
    expect(posted()).toEqual({
      label: "Rumah",
      recipient_name: "Budi Santoso",
      phone: "081234567890",
      street: "Jl. Asia Afrika 8",
      city: "Bandung",
      province: "Jawa Barat",
      postal_code: "40111",
      is_default: true,
    });
    expect(radio.checked).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(radio);
    });
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("adds another address, selects it and focuses it", async () => {
    serveAddresses([[home], [home, office]]);
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Tambah alamat baru" }),
    );
    expect(screen.getByRole("heading", { name: "Alamat baru" })).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Nama alamat" })
        .value,
    ).toBe("");
    await fillForm(user);
    await user.click(screen.getByLabelText("Jadikan alamat utama"));
    await user.click(screen.getByRole("button", { name: "Simpan alamat" }));

    const radio = await screen.findByRole<HTMLInputElement>("radio", {
      name: /Kantor/,
    });
    expect(posted()).toMatchObject({ label: "Kantor", is_default: true });
    expect(radio.checked).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(radio);
    });
    expect(
      screen.getByRole("button", { name: "Tambah alamat baru" }),
    ).toBeTruthy();
  });

  it("says Menyimpan… and cannot be sent twice while saving", async () => {
    let resolvePost: (response: Response) => void = () => undefined;
    serveAddresses([[home]]);
    const list = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            resolvePost = resolve;
          })
        : (list?.(input, init) ?? Promise.reject(new Error("no list"))),
    );
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Tambah alamat baru" }),
    );
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Simpan alamat" }));
    const saving = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Menyimpan…",
    });
    expect(saving.disabled).toBe(true);
    await user.click(saving);

    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    resolvePost(addressResponse(office));
  });

  it("closes the form with Batal and gives the focus back to its button", async () => {
    serveAddresses([[home]]);
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Tambah alamat baru" }),
    );
    await user.click(screen.getByRole("button", { name: "Batal" }));

    expect(screen.queryByRole("form")).toBeNull();
    const add = screen.getByRole("button", { name: "Tambah alamat baru" });
    await waitFor(() => {
      expect(document.activeElement).toBe(add);
    });
    expect(posted()).toBeUndefined();
  });

  it("checks the fields before sending anything", async () => {
    serveAddresses([[]]);
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();
    await screen.findByRole("form", { name: "Alamat baru" });

    await fillForm(user, { phone: "12345", postal: "01234", recipient: "" });
    await user.click(screen.getByRole("button", { name: "Simpan alamat" }));

    const form = screen.getByRole("form", { name: "Alamat baru" });
    const errors = [...form.querySelectorAll(".field__error")].map(
      (p) => p.textContent,
    );
    expect(errors).toEqual([
      "Masukkan nama penerima.",
      "Masukkan nomor telepon Indonesia, misalnya 081234567890 atau +6281234567890.",
      "Kode pos terdiri dari 5 angka dan tidak diawali 0, misalnya 40111.",
    ]);
    expect(posted()).toBeUndefined();
  });

  it("puts the API's field errors under their fields", async () => {
    serveAddresses([[]], () =>
      validationResponse({
        postal_code: "must be a 5-digit Indonesian postal code",
      }),
    );
    renderWithProviders(<Harness />, { session });
    const user = userEvent.setup();
    await screen.findByRole("form", { name: "Alamat baru" });

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Simpan alamat" }));

    const postal = await screen.findByText(
      "Kode pos terdiri dari 5 angka dan tidak diawali 0, misalnya 40111.",
    );
    expect(postal.className).toContain("field__error");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [
      "ADDRESS_LIMIT_REACHED",
      () => detailedErrorResponse(409, "ADDRESS_LIMIT_REACHED", { limit: 20 }),
      "Anda sudah menyimpan 20 alamat, batas maksimal. Hapus salah satu dulu.",
    ],
    [
      "RATE_LIMITED",
      () => errorResponse(429, "RATE_LIMITED"),
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    ],
  ])(
    "shows %s above the button and keeps the form",
    async (_, respond, text) => {
      serveAddresses([[]], respond);
      renderWithProviders(<Harness />, { session });
      const user = userEvent.setup();
      await screen.findByRole("form", { name: "Alamat baru" });

      await fillForm(user);
      await user.click(screen.getByRole("button", { name: "Simpan alamat" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(text);
      expect(screen.getByRole("form", { name: "Alamat baru" })).toBeTruthy();
    },
  );
});
