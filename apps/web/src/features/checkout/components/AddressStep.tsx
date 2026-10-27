import { useEffect, useId, useRef, useState } from "react";
import type { Address } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { AddressForm } from "./AddressForm.tsx";

/** focusAfterClose's value for "the Tambah alamat baru button". */
const ADD_BUTTON = "add-button";

interface AddressStepProps {
  userId: string;
  addresses: Address[];
  /** The address the order goes to, or null when the buyer has none. */
  selectedId: string | null;
  onSelect: (addressId: string) => void;
}

/**
 * Step 1 of checkout: where the order goes (Bab 11 artikel 02).
 *
 * The buyer's saved addresses are a group of native radio buttons inside a
 * <fieldset>: the browser gives them arrow-key navigation, one Tab stop
 * for the whole group, and the legend as the group's name, with no
 * JavaScript of ours. Each option shows the whole address, because "Rumah"
 * alone does not say which house.
 *
 * A buyer without an address sees the form straight away; anyone else can
 * open it with "Tambah alamat baru". After a save the new address is
 * selected and takes the focus: the form, and the button the buyer
 * pressed, have just disappeared.
 */
export function AddressStep({
  userId,
  addresses,
  selectedId,
  onSelect,
}: AddressStepProps) {
  const groupId = useId();
  const [adding, setAdding] = useState(false);
  const showForm = adding || addresses.length === 0;
  // What takes the focus once the form has closed: the address just
  // saved, or the button that opened the form (after "Batal"). A ref,
  // because setting it must not render anything by itself; the effect
  // runs after React has put the list back on screen.
  const focusAfterClose = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const target = focusAfterClose.current;
    if (target === null || showForm) return;
    focusAfterClose.current = null;
    if (target === ADD_BUTTON) {
      addButton.current?.focus();
    } else {
      document.getElementById(`${groupId}-${target}`)?.focus();
    }
  }, [addresses, showForm, groupId]);

  const onCreated = (address: Address) => {
    focusAfterClose.current = address.id;
    onSelect(address.id);
    setAdding(false);
  };

  return (
    <div className="grid gap-4">
      {addresses.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="sr-only">Pilih alamat pengiriman</legend>
          {addresses.map((address) => (
            <label
              key={address.id}
              htmlFor={`${groupId}-${address.id}`}
              className="flex cursor-pointer gap-3 rounded-md border border-input p-3 has-checked:border-primary has-checked:bg-accent"
            >
              <input
                id={`${groupId}-${address.id}`}
                type="radio"
                name={`${groupId}-address`}
                value={address.id}
                checked={address.id === selectedId}
                onChange={() => {
                  onSelect(address.id);
                }}
                className="mt-1 size-4 accent-primary"
              />
              <span className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {address.label}
                  {address.is_default && <Badge>Utama</Badge>}
                </span>
                <span>
                  {address.recipient_name} · {address.phone}
                </span>
                <span className="text-sm text-muted-foreground">
                  {address.street}, {address.city}, {address.province}{" "}
                  {address.postal_code}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {showForm ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">
            {addresses.length === 0
              ? "Tambahkan alamat pengiriman"
              : "Alamat baru"}
          </h3>
          <AddressForm
            userId={userId}
            first={addresses.length === 0}
            onCreated={onCreated}
            onCancel={
              addresses.length === 0
                ? undefined
                : () => {
                    focusAfterClose.current = ADD_BUTTON;
                    setAdding(false);
                  }
            }
          />
        </div>
      ) : (
        <Button
          ref={addButton}
          variant="outline"
          className="justify-self-start"
          onClick={() => {
            setAdding(true);
          }}
        >
          Tambah alamat baru
        </Button>
      )}
    </div>
  );
}
