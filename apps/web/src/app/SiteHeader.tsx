import { Link } from "react-router";
import { AccountNav } from "@/features/auth/components/AccountNav.tsx";
import { CartNavLink } from "@/features/cart/components/CartNavLink.tsx";
import { ThemeToggle } from "@/features/theme/components/ThemeToggle.tsx";

/**
 * The site's banner and main navigation, on every page (RootLayout).
 *
 * <Link> renders a real <a href>: it can be opened in a new tab, copied
 * and read by a screen reader as a link. A plain click is caught and
 * handled by the router without a page load. <NavLink> is a Link that
 * knows when its page is the current one: it sets aria-current="page"
 * (which the CSS styles), so the current page is announced too.
 *
 * Styled with Tailwind utilities: each class sets one property (flex,
 * gap-x-6, text-3xl, font-bold), so the layout is read in the markup
 * instead of in a stylesheet, and nothing else on the page can be
 * affected by a rename. Breakpoint, state and arbitrary variants
 * (md:, hover:, [&_a]:) cover what a selector used to.
 *
 * JSX looks like HTML but compiles to function calls, not markup: with
 * "jsx": "react-jsx" (tsconfig.app.json) the build turns
 * <header className="site-header"> into jsx("header", { className: … }),
 * imported for you from react/jsx-runtime. So `className`, not `class`;
 * every tag is closed; a component returns one root element.
 */
export function SiteHeader() {
  return (
    <header className="mx-auto max-w-page px-4 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <Link
          to="/"
          className="text-2xl font-bold text-inherit no-underline sm:text-3xl"
        >
          GoShop
        </Link>
        <div className="flex items-center gap-x-4">
          <nav aria-label="Utama">
            {/* [&_a[aria-current=page]]: an arbitrary variant, for the link
              NavLink marks as the page on screen. */}
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 [&_a[aria-current=page]]:font-bold [&_a[aria-current=page]]:decoration-2">
              <li>
                <CartNavLink />
              </li>
              <AccountNav />
            </ul>
          </nav>
          {/* Outside the nav: it changes the page's look, it goes nowhere. */}
          <ThemeToggle />
        </div>
      </div>
      <p className="text-muted-foreground mt-1 text-sm sm:text-base">
        Toko online contoh dari kursus Fullstack Santekno.
      </p>
    </header>
  );
}
