import { ShieldAlert } from "lucide-react";
import type { User } from "@goshop/shared";
import { CenteredPage } from "@/app/CenteredPage.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useLogout } from "../hooks/useLogout.ts";
import { roleLabel } from "../roles.ts";

/**
 * What a logged-in account without a staff role sees, at every dashboard
 * URL: who is logged in, why that is not enough, and the way out. Never
 * the dashboard, not even its empty frame.
 *
 * "Keluar" ends the session on the server. The refresh cookie belongs to
 * the API's origin, so it is the same cookie the storefront uses on this
 * browser: logging out here logs the buyer out of the storefront too. The
 * page says so before the button.
 */
export function NoAccessPage({ user }: { user: User }) {
  useDocumentTitle("Tidak ada akses — GoShop Admin");
  const logout = useLogout();

  return (
    <CenteredPage>
      <Card className="grid gap-4">
        <ShieldAlert aria-hidden="true" className="size-8 text-destructive" />
        <h1 tabIndex={-1}>Tidak ada akses</h1>
        <p>
          Anda masuk sebagai <strong>{user.email}</strong> dengan peran{" "}
          <strong>{roleLabel(user.role)}</strong>. Dasbor ini hanya untuk
          penjual dan admin.
        </p>
        <p className="text-muted-foreground">
          Keluar, lalu masuk dengan akun penjual atau admin. Keluar di sini juga
          mengeluarkan Anda dari toko GoShop di browser ini.
        </p>
        {logout.isError && (
          <p role="alert" className="text-destructive">
            Gagal keluar. Periksa koneksi Anda, lalu coba lagi.
          </p>
        )}
        <div>
          <Button
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate();
            }}
          >
            {logout.isPending ? "Memproses…" : "Keluar"}
          </Button>
        </div>
      </Card>
    </CenteredPage>
  );
}
