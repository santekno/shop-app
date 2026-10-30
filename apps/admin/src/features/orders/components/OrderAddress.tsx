import type { ShippingAddressSnapshot } from "@goshop/shared";
import { cn } from "@/lib/utils.ts";

interface OrderAddressProps {
  address: ShippingAddressSnapshot;
  className?: string;
}

/**
 * Where the parcel goes, as the courier reads it: the recipient, the
 * phone, then the address from street to postal code. It is the copy made
 * at checkout, so a buyer who edits their address book afterwards does not
 * move an order already paid for.
 *
 * <address> is HTML's element for contact information; its browser
 * italics are turned off.
 */
export function OrderAddress({ address, className }: OrderAddressProps) {
  return (
    <address className={cn("grid not-italic", className)}>
      <span className="font-semibold">{address.recipient_name}</span>
      <span>{address.phone}</span>
      <span>{address.street}</span>
      <span>
        {address.city}, {address.province} {address.postal_code}
      </span>
    </address>
  );
}
