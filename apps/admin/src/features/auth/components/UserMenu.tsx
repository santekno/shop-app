import { ChevronDown, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu.tsx";
import { useLogout } from "../hooks/useLogout.ts";
import { roleLabel } from "../roles.ts";
import { useSessionUser } from "../session-context.ts";

/**
 * The header's menu under the user's name: who is logged in, as which
 * role, and "Keluar". shadcn/ui's DropdownMenu, so the trigger is a real
 * button (aria-haspopup, aria-expanded) and the menu has the keyboard
 * handling of a menu (arrows, Escape, the focus back on the trigger).
 *
 * After a successful logout the session ends, RequireStaff renders the
 * login page, and useRouteFocus moves the focus to its heading: the menu
 * that had the focus is gone. When the logout fails, the user stays
 * logged in and is told so, next to the menu.
 */
export function UserMenu() {
  const user = useSessionUser();
  const logout = useLogout();

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={logout.isPending}>
            <span className="max-w-40 truncate">{user.name}</span>
            <span className="hidden text-muted-foreground sm:inline">
              ({roleLabel(user.role)})
            </span>
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <span className="block">{user.name}</span>
            <span className="block font-normal text-muted-foreground">
              {user.email}
            </span>
            <span className="block font-normal text-muted-foreground">
              Peran: {roleLabel(user.role)}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              logout.mutate();
            }}
          >
            <LogOut aria-hidden="true" />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {logout.isError && (
        <p role="alert" className="text-sm text-destructive">
          Gagal keluar. Periksa koneksi Anda, lalu coba lagi.
        </p>
      )}
    </div>
  );
}
