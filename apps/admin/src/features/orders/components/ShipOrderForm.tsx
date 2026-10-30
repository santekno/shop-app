import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { shipOrderSchema } from "@goshop/shared";
import type {
  Order,
  ShipOrderInput,
  ShipOrderOutput,
  ShipRequest,
} from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { setApiFieldErrors } from "@/lib/api-form-errors.ts";
import { courierText } from "../order-status.ts";

interface ShipOrderFormProps {
  order: Order;
  /** The ship request is on its way: the button waits. */
  pending: boolean;
  /**
   * Sends the resi. Resolves when the order shipped; rejects with the
   * API's error, which the form puts on the field when it is about the
   * field (400 VALIDATION_FAILED) and leaves to the page otherwise.
   */
  onShip: (body: ShipRequest) => Promise<unknown>;
}

/**
 * "Kirim pesanan": the one field a shipment needs, the courier's airway
 * bill (nomor resi). The courier and the service are not chosen here:
 * the buyer chose them at checkout and paid for them, so the form shows
 * them, and the resi must come from that courier.
 *
 * shipOrderSchema (@goshop/shared, ready for the mobile app) is the
 * contract's rule: 6–40 letters, digits or hyphens, trimmed and
 * upper-cased first, as the API stores it. The API checks it again, and
 * its field message lands on the same field.
 */
export function ShipOrderForm({ order, pending, onShip }: ShipOrderFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ShipOrderInput, unknown, ShipOrderOutput>({
    resolver: zodResolver(shipOrderSchema),
    defaultValues: { tracking_number: "" },
  });
  const courier = courierText(order.shipping.courier, order.shipping.service);

  const onSubmit = async (body: ShipOrderOutput) => {
    try {
      await onShip(body);
    } catch (error) {
      setApiFieldErrors(error, setError, ["tracking_number"]);
    }
  };

  return (
    <form
      noValidate
      aria-label="Kirim pesanan"
      className="grid max-w-md justify-items-start gap-3"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <p>
        Kurir pilihan pembeli: <strong>{courier}</strong>. Serahkan paket ke
        kurir ini, lalu isi nomor resi dari struknya.
      </p>
      <TextField
        label="Nomor resi"
        hint="Huruf, angka dan tanda hubung, 6–40 karakter, misalnya JNE0123456789."
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        error={errors.tracking_number?.message}
        {...register("tracking_number")}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Memproses…" : "Tandai dikirim"}
      </Button>
    </form>
  );
}
