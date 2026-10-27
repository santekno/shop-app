import { Link } from "react-router";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";

/**
 * What the cart page shows when the cart has no lines.
 *
 * Prototyped with AI, then reviewed (docs/web/README.md, Bab 10, artikel
 * 06, has the prompt, the raw draft and every change). In short, the
 * draft was a <section> landmark with its own border, card background
 * and a hard-coded heading id, inside a page that is already a card; it
 * coloured the text like a link (text-primary), used a radius outside
 * GoShop's scale (rounded-xl), renamed the link the tests and the
 * buyer's habits know ("Lihat katalog"), and added a default export.
 */
export function EmptyCart() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center sm:py-12">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <ShoppingCart
          aria-hidden="true"
          className="size-8 text-muted-foreground"
        />
      </div>
      <p className="font-semibold">Keranjang Anda masih kosong.</p>
      <p className="text-sm text-muted-foreground">
        Jelajahi katalog dan tambahkan produk yang Anda suka.
      </p>
      {/* A link that looks like a button is still a link: it goes to
          another page. Full width on a phone, an easy target. */}
      <Button asChild className="mt-2 w-full sm:w-auto">
        <Link to="/">Lihat katalog</Link>
      </Button>
    </div>
  );
}
