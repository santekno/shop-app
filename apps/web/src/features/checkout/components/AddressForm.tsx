import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { addressSchema, isApiError } from "@goshop/shared";
import type { Address, AddressCreate, AddressInput } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { FormAlert } from "@/components/ui/FormAlert.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { setApiFieldErrors } from "@/lib/api-form-errors.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { useCreateAddress } from "../hooks/useCreateAddress.ts";

/** Every field of the form, in order: where the API's errors may land. */
const FIELDS = [
  "label",
  "recipient_name",
  "phone",
  "street",
  "city",
  "province",
  "postal_code",
] as const;

interface AddressFormProps {
  userId: string;
  /** Whether the buyer has no address yet (the new one becomes the default). */
  first: boolean;
  /** The address the API created, once the list has it. */
  onCreated: (address: Address) => void;
  /** Shown only when the buyer has another address to go back to. */
  onCancel?: (() => void) | undefined;
}

/**
 * A new delivery address (Bab 11 artikel 02).
 *
 * The rules are `addressSchema` from @goshop/shared, the same schema the
 * mobile app will use, checked against the contract's AddressCreate type.
 * The schema cleans the phone number ("0812-3456 7890" is sent as
 * "081234567890"), so onSubmit receives what the API expects.
 *
 * `autoComplete` names each field the way the HTML standard does
 * (`street-address`, `address-level2` for the city, `address-level1` for
 * the province, `postal-code`, `tel`), so a browser can fill a saved
 * address in one go, and the phone's keyboard shows digits for the phone
 * and the postal code (`inputMode`).
 */
export function AddressForm({
  userId,
  first,
  onCreated,
  onCancel,
}: AddressFormProps) {
  const create = useCreateAddress(userId);
  const defaultId = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AddressInput, unknown, AddressCreate>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: first ? "Rumah" : "",
      recipient_name: "",
      phone: "",
      street: "",
      city: "",
      province: "",
      postal_code: "",
      is_default: first,
    },
  });

  const onSubmit = (address: AddressCreate) => {
    create.mutate(address, {
      onSuccess: onCreated,
      onError: (error) => {
        // A field's own problem under that field (the Indonesian text
        // comes from lib/api-form-errors.ts), anything else above the
        // button.
        if (setApiFieldErrors(error, setError, FIELDS)) return;
        setError("root.server", {
          message: isApiError(error, "ADDRESS_LIMIT_REACHED")
            ? "Anda sudah menyimpan 20 alamat, batas maksimal. Hapus salah satu dulu."
            : errorMessage(error),
        });
      },
    });
  };

  return (
    <form
      className="grid gap-4"
      noValidate
      aria-label="Alamat baru"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nama alamat"
          hint="Misalnya Rumah atau Kantor."
          autoComplete="off"
          error={errors.label?.message}
          {...register("label")}
        />
        <TextField
          label="Nama penerima"
          autoComplete="name"
          error={errors.recipient_name?.message}
          {...register("recipient_name")}
        />
      </div>
      <TextField
        label="Nomor telepon"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        error={errors.phone?.message}
        {...register("phone")}
      />
      <TextField
        label="Alamat lengkap"
        hint="Nama jalan, nomor rumah, RT/RW, kelurahan dan kecamatan."
        autoComplete="street-address"
        error={errors.street?.message}
        {...register("street")}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Kota atau kabupaten"
          autoComplete="address-level2"
          error={errors.city?.message}
          {...register("city")}
        />
        <TextField
          label="Provinsi"
          autoComplete="address-level1"
          error={errors.province?.message}
          {...register("province")}
        />
        <TextField
          label="Kode pos"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          error={errors.postal_code?.message}
          {...register("postal_code")}
        />
      </div>
      {!first && (
        <div className="flex items-center gap-2">
          <input
            id={defaultId}
            type="checkbox"
            className="size-4 accent-primary"
            {...register("is_default")}
          />
          <label htmlFor={defaultId}>Jadikan alamat utama</label>
        </div>
      )}
      <FormAlert error={errors.root?.server} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Menyimpan…" : "Simpan alamat"}
        </Button>
        {onCancel !== undefined && (
          <Button variant="outline" onClick={onCancel}>
            Batal
          </Button>
        )}
      </div>
    </form>
  );
}
