import { Menu, X } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button.tsx";
import { UserMenu } from "@/features/auth/components/UserMenu.tsx";
import { ConnectionStatus } from "@/features/realtime/components/ConnectionStatus.tsx";
import { SIDEBAR_ID } from "./Sidebar.tsx";

interface AppHeaderProps {
  /** Whether the phone menu (the sidebar below `md`) is open. */
  menuOpen: boolean;
  onToggleMenu: () => void;
}

/**
 * The dashboard's banner: the menu button (phones only), the name of the
 * app, and the user menu. <header> outside <main> is the page's banner
 * landmark.
 *
 * The menu button is a disclosure: aria-expanded says whether the sidebar
 * it controls (aria-controls) is shown, and its name stays "Menu" in both
 * states, so a screen reader hears "Menu, tombol, diperluas/diciutkan"
 * rather than a name that changes under the focus.
 */
export function AppHeader({ menuOpen, onToggleMenu }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-expanded={menuOpen}
          aria-controls={SIDEBAR_ID}
          onClick={onToggleMenu}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="sr-only">Menu</span>
        </Button>
        <Link to="/" className="text-lg font-bold text-foreground no-underline">
          GoShop{" "}
          <span className="font-normal text-muted-foreground">Admin</span>
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <ConnectionStatus />
        <UserMenu />
      </div>
    </header>
  );
}
