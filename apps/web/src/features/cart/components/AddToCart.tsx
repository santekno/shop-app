import { Link } from "react-router";
import { cartErrorMessage } from "../cart-errors.ts";
import { useAddToCart } from "../hooks/useAddToCart.ts";

interface AddToCartProps {
  /** The variant to add. */
  variantId: string;
  /** How many units, at least 1 (ProductDetail keeps it within stock). */
  quantity: number;
}

/** "Tambah ke keranjang", with what happened announced below it. */
export function AddToCart({ variantId, quantity }: AddToCartProps) {
  const addToCart = useAddToCart();

  return (
    <div className="add-to-cart">
      <button
        type="button"
        // One add at a time: a second click before the first answers
        // could, for a guest without a cart, create two carts.
        disabled={addToCart.isPending}
        onClick={() => {
          addToCart.mutate({ variant_id: variantId, quantity });
        }}
      >
        {addToCart.isPending ? "Menambahkan…" : "Tambah ke keranjang"}
      </button>
      {/* Always rendered: a live region must exist before its text
          changes, or screen readers miss the announcement. */}
      <p role="status" className="add-to-cart__status">
        {addToCart.isSuccess && (
          <>
            Ditambahkan ke keranjang.{" "}
            <Link to="/keranjang">Lihat keranjang</Link>
          </>
        )}
      </p>
      {addToCart.isError && (
        <p role="alert" className="error-text">
          {cartErrorMessage(addToCart.error)}
        </p>
      )}
    </div>
  );
}
