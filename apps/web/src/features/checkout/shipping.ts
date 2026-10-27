import type { Address, ShippingQuote } from "@goshop/shared";

/**
 * The courier service the buyer picked, and for which address: a quote
 * belongs to one destination, so a choice made for another address no
 * longer counts.
 */
export interface ShippingChoice {
  addressId: string;
  courier: ShippingQuote["courier"];
  service: string;
}

/** Whether a choice and a quote name the same courier service. */
export const sameService = (
  choice: Pick<ShippingChoice, "courier" | "service">,
  quote: Pick<ShippingQuote, "courier" | "service">,
): boolean =>
  choice.courier === quote.courier && choice.service === quote.service;

/**
 * The address the order goes to: the buyer's pick while it still exists,
 * otherwise the default address (the API lists it first), otherwise none.
 * Derived on every render from the list and the pick, so there is no
 * effect that "selects the default" after the list arrives, and no render
 * where the two disagree.
 */
export const chosenAddressId = (
  addresses: readonly Address[] | undefined,
  picked: string | null,
): string | null => {
  if (addresses === undefined || addresses.length === 0) return null;
  if (picked !== null && addresses.some((a) => a.id === picked)) return picked;
  return (addresses.find((a) => a.is_default) ?? addresses[0])?.id ?? null;
};

/**
 * The courier choice that still holds: made for the chosen address, and
 * still among that address's quotes. Anything else is null, and the buyer
 * picks again; nothing is reset by an effect.
 */
export const validShippingChoice = (
  choice: ShippingChoice | null,
  addressId: string | null,
  quotes: readonly ShippingQuote[] | undefined,
): ShippingChoice | null => {
  if (choice === null || addressId === null || quotes === undefined) {
    return null;
  }
  if (choice.addressId !== addressId) return null;
  return quotes.some((quote) => sameService(choice, quote)) ? choice : null;
};

/**
 * A courier's delivery estimate in Indonesian. Couriers (and the API's
 * static table) write it in English, "2-3 days"; only the unit is
 * translated, the numbers stay as the courier wrote them.
 */
export const formatEtd = (etd: string): string =>
  etd.replace(/\bdays?\b/gi, "hari").replace(/\bhours?\b/gi, "jam");
