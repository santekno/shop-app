import { ApiError } from "@goshop/shared";
import type { OrderStatus } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import type { Role } from "@/features/auth/roles.ts";
import {
  ACTION_LABEL,
  actionDoneMessage,
  actionErrorMessage,
  actionFailure,
  orderActions,
  withheldOrderActions,
} from "./order-actions.ts";
import type { OrderAction } from "./order-actions.ts";

const apiError = (
  status: number,
  code: string,
  details?: Record<string, unknown>,
) => new ApiError({ status, code, message: "x", details });

describe("orderActions", () => {
  it.each<[OrderStatus, Role, OrderAction[]]>([
    ["pending_payment", "admin", ["cancel"]],
    ["paid", "admin", ["process", "cancel"]],
    ["processing", "admin", ["ship", "cancel"]],
    ["shipped", "admin", ["complete"]],
    ["completed", "admin", []],
    ["cancelled", "admin", []],
    ["pending_payment", "seller", []],
    ["paid", "seller", ["process"]],
    ["processing", "seller", ["ship"]],
    ["shipped", "seller", ["complete"]],
    ["completed", "seller", []],
    ["cancelled", "seller", []],
    ["paid", "buyer", []],
    ["processing", "buyer", []],
  ])("a %s order offers %s: %j", (status, role, actions) => {
    expect(orderActions({ status }, role)).toEqual(actions);
  });
});

describe("withheldOrderActions", () => {
  it.each<[OrderStatus, OrderAction[]]>([
    ["pending_payment", ["cancel"]],
    ["paid", ["cancel"]],
    ["processing", ["cancel"]],
    ["shipped", []],
    ["completed", []],
    ["cancelled", []],
  ])("withholds from a seller, for a %s order: %j", (status, withheld) => {
    expect(withheldOrderActions({ status }, "seller")).toEqual(withheld);
  });

  it.each<OrderStatus>(["pending_payment", "paid", "processing", "shipped"])(
    "withholds nothing from an admin (%s)",
    (status) => {
      expect(withheldOrderActions({ status }, "admin")).toEqual([]);
    },
  );

  it("withholds everything the status allows from a buyer", () => {
    expect(withheldOrderActions({ status: "paid" }, "buyer")).toEqual([
      "process",
      "cancel",
    ]);
  });
});

describe("ACTION_LABEL and actionDoneMessage", () => {
  it("names each button", () => {
    expect(ACTION_LABEL).toEqual({
      process: "Proses pesanan",
      ship: "Tandai dikirim",
      complete: "Tandai selesai",
      cancel: "Batalkan pesanan",
    });
  });

  it.each<[OrderAction, string]>([
    [
      "process",
      "Pesanan GS-1 sedang diproses. Kemas barangnya, lalu kirim dengan nomor resi.",
    ],
    [
      "ship",
      "Pesanan GS-1 ditandai dikirim. Pembeli dapat melacaknya dengan nomor resi.",
    ],
    ["complete", "Pesanan GS-1 selesai."],
    ["cancel", "Pesanan GS-1 dibatalkan. Stok dan voucher sudah dikembalikan."],
  ])("says what %s did, with the order's code", (action, message) => {
    expect(actionDoneMessage(action, "GS-1")).toBe(message);
  });
});

describe("actionFailure", () => {
  it.each([
    ["409 INVALID_TRANSITION", apiError(409, "INVALID_TRANSITION"), "conflict"],
    ["403 FORBIDDEN", apiError(403, "FORBIDDEN"), "forbidden"],
    ["404 NOT_FOUND", apiError(404, "NOT_FOUND"), "gone"],
    ["a plain Error", new Error("x"), "retry"],
  ])("sorts %s as %s", (_name, error, failure) => {
    expect(actionFailure(error)).toBe(failure);
  });

  // The request went out and the answer does not say whether the change
  // was made: sending it again would be refused as "someone else".
  it.each([
    ["the network", apiError(0, "NETWORK_ERROR")],
    ["the client's timeout", apiError(0, "CLIENT_TIMEOUT")],
    ["500 INTERNAL_ERROR", apiError(500, "INTERNAL_ERROR")],
    ["503 TIMEOUT", apiError(503, "TIMEOUT")],
    ["a gateway's 502", apiError(502, "INVALID_RESPONSE")],
    ["a gateway's 504", apiError(504, "INVALID_RESPONSE")],
    ["502 with a code", apiError(502, "INTERNAL_ERROR")],
    ["504 with a code", apiError(504, "TIMEOUT")],
    ["an unreadable 200", apiError(200, "INVALID_RESPONSE")],
    ["an unreadable 299", apiError(299, "INVALID_RESPONSE")],
  ])("sorts %s as uncertain", (_name, error) => {
    expect(actionFailure(error)).toBe("uncertain");
  });

  // Refused before anything changed: the same action may work later.
  it.each([
    ["429 RATE_LIMITED", apiError(429, "RATE_LIMITED")],
    ["400 VALIDATION_FAILED", apiError(400, "VALIDATION_FAILED")],
    ["401 UNAUTHORIZED", apiError(401, "UNAUTHORIZED")],
    ["an unreadable 400", apiError(400, "INVALID_RESPONSE")],
    ["an unreadable 300", apiError(300, "INVALID_RESPONSE")],
    ["an unreadable 499", apiError(499, "INVALID_RESPONSE")],
    ["a request this client aborted", apiError(0, "ABORTED")],
  ])("sorts %s as retry", (_name, error) => {
    expect(actionFailure(error)).toBe("retry");
  });
});

describe("actionErrorMessage", () => {
  it("names the status the order moved to when the API says it", () => {
    expect(
      actionErrorMessage(
        "process",
        apiError(409, "INVALID_TRANSITION", {
          status: "shipped",
          to: "processing",
        }),
      ),
    ).toBe(
      "Pesanan ini sudah diubah orang lain: statusnya sekarang “Dikirim”. Data terbaru dimuat ulang; periksa sebelum melanjutkan.",
    );
  });

  it.each([
    ["no details", undefined],
    ["an unknown status", { status: "returned" }],
    ["a status that is not text", { status: 3 }],
  ])("says it changed without naming a status for %s", (_name, details) => {
    expect(
      actionErrorMessage("ship", apiError(409, "INVALID_TRANSITION", details)),
    ).toBe(
      "Pesanan ini sudah diubah orang lain. Data terbaru dimuat ulang; periksa statusnya sebelum melanjutkan.",
    );
  });

  it("says only an admin may cancel, for a refused cancel", () => {
    expect(actionErrorMessage("cancel", apiError(403, "FORBIDDEN"))).toBe(
      "Hanya admin yang boleh membatalkan pesanan. Minta admin toko untuk membatalkannya.",
    );
  });

  it("says the account may not change it, for any other refused change", () => {
    expect(actionErrorMessage("process", apiError(403, "FORBIDDEN"))).toBe(
      "Akun Anda tidak boleh mengubah pesanan ini.",
    );
  });

  it("says the order is gone for a 404", () => {
    expect(actionErrorMessage("complete", apiError(404, "NOT_FOUND"))).toBe(
      "Pesanan ini tidak ditemukan lagi.",
    );
  });

  const ENDING =
    ", jadi belum pasti perubahan ini tersimpan. Data terbaru dimuat ulang; periksa statusnya, lalu ulangi hanya jika statusnya belum berubah.";

  it.each([
    [
      "the client's timeout",
      apiError(0, "CLIENT_TIMEOUT"),
      "Server tidak menjawab tepat waktu",
    ],
    [
      "the server's TIMEOUT",
      apiError(503, "TIMEOUT"),
      "Server tidak menjawab tepat waktu",
    ],
    [
      "a dropped connection",
      apiError(0, "NETWORK_ERROR"),
      "Koneksi terputus sebelum jawaban server sampai",
    ],
    [
      "a server error",
      apiError(500, "INTERNAL_ERROR"),
      "Server mengalami kesalahan saat menjawab",
    ],
    [
      "a gateway's 502",
      apiError(502, "INVALID_RESPONSE"),
      "Server mengalami kesalahan saat menjawab",
    ],
    [
      "an unreadable 200",
      apiError(200, "INVALID_RESPONSE"),
      "Server mengalami kesalahan saat menjawab",
    ],
  ])(
    "names the cause and says the change may be saved, for %s",
    (_name, error, cause) => {
      expect(actionErrorMessage("process", error)).toBe(`${cause}${ENDING}`);
    },
  );

  it("uses the general sentence for RATE_LIMITED", () => {
    expect(actionErrorMessage("process", apiError(429, "RATE_LIMITED"))).toBe(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
  });

  it.each([
    ["400 VALIDATION_FAILED", apiError(400, "VALIDATION_FAILED")],
    ["an unreadable 400", apiError(400, "INVALID_RESPONSE")],
  ])("says the order did not change for %s", (_name, error) => {
    expect(actionErrorMessage("ship", error)).toBe(
      "Pesanan belum berubah: server menolak permintaan ini. Coba lagi.",
    );
  });
});
