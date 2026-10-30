import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";
import type { Role } from "../roles.ts";
import { roleLabel } from "../roles.ts";
import { useSessionUser } from "../session-context.ts";

/**
 * One sentence in the header when the logged-in role changes during the
 * session (artikel 08): a refresh, every ~15 minutes or after a 403,
 * brought another role. Buttons appear or disappear at that moment
 * ("Batalkan pesanan", for one); this says why, instead of leaving the
 * user to wonder where it went.
 *
 * - The sentence sits in a `role="status"` element that is always there
 *   (empty until a change), so a screen reader announces it politely
 *   without moving the focus.
 * - "Tutup" removes it and calls `onClose`, which puts the focus
 *   somewhere that stays (the button that had it is gone); the next
 *   change brings the sentence back.
 * - Nothing at login or after a reload: the role is new then, not changed.
 *   A role without the dashboard (a buyer) never sees it: RequireStaff
 *   replaces the whole layout with the "no access" page.
 */
export function RoleChangeNotice({ onClose }: { onClose: () => void }) {
  const { role } = useSessionUser();
  // The role this component last saw, and the change it has to tell.
  // Adjusting state while rendering (react.dev, "You Might Not Need an
  // Effect"): the sentence is there in the same render as the new role,
  // with no effect and no extra render with the old sentence.
  const [seen, setSeen] = useState<Role>(role);
  const [change, setChange] = useState<{ from: Role; to: Role } | null>(null);
  if (role !== seen) {
    setSeen(role);
    setChange({ from: seen, to: role });
  }

  return (
    <div className="flex max-w-xs items-start gap-1">
      <p role="status" className="text-right text-sm">
        {change !== null &&
          `Peran Anda berubah dari ${roleLabel(change.from)} menjadi ${roleLabel(change.to)}. Tindakan yang tersedia sudah disesuaikan.`}
      </p>
      {change !== null && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Tutup pemberitahuan peran"
          onClick={() => {
            setChange(null);
            onClose();
          }}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
