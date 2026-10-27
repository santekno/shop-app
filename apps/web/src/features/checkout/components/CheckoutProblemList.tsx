import { Link } from "react-router";
import { formatRupiah } from "@goshop/shared";
import type { CartLine, CheckoutProblem } from "@goshop/shared";

interface CheckoutProblemListProps {
  problems: CheckoutProblem[];
  /** The cart's lines, for the product names a problem does not carry. */
  lines: readonly CartLine[] | undefined;
}

/** One problem, in the buyer's words. */
const describe = (problem: CheckoutProblem): string => {
  switch (problem.problem) {
    case "unavailable":
      return "sudah tidak dijual. Hapus dari keranjang.";
    case "insufficient_stock":
      return problem.available === 0
        ? "stoknya habis. Hapus dari keranjang."
        : `stok tersisa ${String(problem.available)}, Anda memesan ${String(problem.quantity)}.`;
    case "price_changed":
      return `harganya berubah dari ${formatRupiah(problem.price_when_added)} menjadi ${formatRupiah(problem.unit_price)}.`;
  }
};

/**
 * The lines checkout refuses (409 CHECKOUT_PROBLEMS, read by
 * `checkoutProblems` in @goshop/shared), and where to fix them.
 *
 * A problem names the variant and its SKU, not the product; the name
 * comes from the cart the page already has. The fixes themselves (accept
 * the price, lower the quantity, remove the line) live on the cart page
 * (artikel 01), one link away; this list only says what is wrong.
 */
export function CheckoutProblemList({
  problems,
  lines,
}: CheckoutProblemListProps) {
  const nameOf = (variantId: string, sku: string) => {
    const line = lines?.find((each) => each.variant_id === variantId);
    return line === undefined
      ? sku
      : `${line.product_name} (${line.variant_name})`;
  };

  return (
    <div role="alert" className="grid gap-2">
      <p className="text-destructive">
        Ada barang yang tidak bisa dibeli seperti sekarang:
      </p>
      <ul className="list-disc pl-5">
        {problems.map((problem) => (
          <li key={problem.variant_id}>
            {nameOf(problem.variant_id, problem.sku)}: {describe(problem)}
          </li>
        ))}
      </ul>
      <p>
        <Link to="/keranjang">Perbaiki di keranjang</Link>, lalu kembali ke
        sini.
      </p>
    </div>
  );
}
