import { describe, expect, it } from "vitest";
import { address, quote } from "@/test/checkout-fixtures.ts";
import {
  chosenAddressId,
  formatEtd,
  sameService,
  validShippingChoice,
} from "./shipping.ts";

describe("sameService", () => {
  it("is true only when both the courier and the service match", () => {
    const jneReg = { courier: "jne", service: "REG" } as const;
    expect(sameService(jneReg, quote())).toBe(true);
    expect(sameService(jneReg, quote({ service: "YES" }))).toBe(false);
    expect(sameService(jneReg, quote({ courier: "jnt" }))).toBe(false);
  });
});

describe("chosenAddressId", () => {
  const home = address("a1", { is_default: true });
  const office = address("a2");

  it("is null while the list has not arrived, or is empty", () => {
    expect(chosenAddressId(undefined, "a1")).toBeNull();
    expect(chosenAddressId([], "a1")).toBeNull();
  });

  it("keeps the buyer's pick while it is still in the list", () => {
    expect(chosenAddressId([home, office], "a2")).toBe("a2");
  });

  it("falls back to the default address when nothing, or a deleted one, is picked", () => {
    expect(chosenAddressId([office, home], null)).toBe("a1");
    expect(chosenAddressId([office, home], "gone")).toBe("a1");
  });

  it("falls back to the first address when none is marked default", () => {
    expect(chosenAddressId([office, address("a3")], null)).toBe("a2");
  });
});

describe("validShippingChoice", () => {
  const choice = { addressId: "a1", courier: "jne", service: "REG" } as const;

  it("keeps a choice made for this address that is still quoted", () => {
    expect(validShippingChoice(choice, "a1", [quote()])).toBe(choice);
  });

  it("drops a choice made for another address", () => {
    expect(validShippingChoice(choice, "a2", [quote()])).toBeNull();
  });

  it("drops a choice the quotes no longer offer", () => {
    expect(
      validShippingChoice(choice, "a1", [quote({ service: "YES" })]),
    ).toBeNull();
  });

  it("is null without a choice, an address or quotes", () => {
    expect(validShippingChoice(null, "a1", [quote()])).toBeNull();
    expect(validShippingChoice(choice, null, [quote()])).toBeNull();
    expect(validShippingChoice(choice, "a1", undefined)).toBeNull();
  });
});

describe("formatEtd", () => {
  it.each([
    ["2-3 days", "2-3 hari"],
    ["1 day", "1 hari"],
    ["1-2 Days", "1-2 hari"],
    ["6 hours", "6 jam"],
    ["1 HOUR", "1 jam"],
    ["3", "3"],
  ])("writes %j as %j", (etd, expected) => {
    expect(formatEtd(etd)).toBe(expected);
  });
});
