import { ChevronDown, LogOut } from "lucide-react";
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
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut aria-hidden="true" />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
