import { ChevronDown, LogOut, Package, UserRound } from "lucide-react";
import Link from "next/link";
import type { User } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu.tsx";

interface AccountMenuProps {
  user: User;
  onLogout: () => void;
}

/**
 * The logged-in buyer's menu under their name: shadcn/ui's DropdownMenu.
 *
 * Its own module, loaded with React.lazy by AccountNav: Radix's menu,
 * Floating UI and their helpers are about 60 kB of JavaScript that a
 * guest never needs, so they stay out of the main bundle until someone
 * logs in (the same idea as Bab 9's lazy routes).
 */
export function AccountMenu({ user, onLogout }: AccountMenuProps) {
  return (
    <DropdownMenu>
      {/* The trigger is a real button; Radix sets aria-haspopup and
          aria-expanded, and opens the menu on Enter, Space or the down
          arrow. */}
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          Halo, {user.name}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-muted-foreground">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* asChild: the item is a real link (Radix gives it the item's
            keyboard handling), so it can also be opened in a new tab. */}
        <DropdownMenuItem asChild>
          <Link href="/akun">
            <UserRound aria-hidden="true" />
            Akun saya
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/pesanan">
            <Package aria-hidden="true" />
            Pesanan saya
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut aria-hidden="true" />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
