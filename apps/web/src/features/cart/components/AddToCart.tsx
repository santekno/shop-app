import { Link } from "react-router";
import type { Money } from "@goshop/shared";
import { cartErrorMessage } from "../cart-errors.ts";
import { useAddToCart } from "../hooks/useAddToCart.ts";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";

interface AddToCartProps {
  /** The variant to add. */
  variantId: string;
  /** Its price, for the cart's optimistic subtotal. */
  unitPrice: Money;
  /** How many units, at least 1 (ProductDetail keeps it within stock). */
  quantity: number;
}

/** "Tambah ke keranjang", with what happened announced below it. */
export function AddToCart({ variantId, unitPrice, quantity }: AddToCartProps) {
  const addToCart = useAddToCart();

  return (
    <div className="add-to-cart grid justify-items-start gap-2">
      <Button
        // One add at a time: a second click before the first answers
        // could, for a guest without a cart, create two carts.
        disabled={addToCart.isPending}
        onClick={() => {
          addToCart.mutate({
            item: { variant_id: variantId, quantity },
            unitPrice,
          });
        }}
      >
        <ShoppingCart aria-hidden="true" />
        {addToCart.isPending ? "Menambahkan…" : "Tambah ke keranjang"}
      </Button>
      {/* Always rendered: a live region must exist before its text
          changes, or screen readers miss the announcement. */}
      <p role="status" className="empty:hidden">
        {addToCart.isSuccess && (
          <>
            Ditambahkan ke keranjang.{" "}
            <Link to="/keranjang">Lihat keranjang</Link>
          </>
        )}
      </p>
      {/* After the rollback: the count is back where it was, and this
          says why. */}
      {addToCart.isError && (
        <p role="alert" className="text-destructive">
          {cartErrorMessage(addToCart.error)}
        </p>
      )}
    </div>
  );
}
