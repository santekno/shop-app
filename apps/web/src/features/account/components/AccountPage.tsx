import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { meQuery } from "../api/queries.ts";

const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "long" });

/**
 * /akun: the logged-in buyer's account, from GET /v1/me. Rendered only
 * inside RequireAuth, so the session is there; the profile itself is
 * fetched (not taken from the login answer) because it can change while
 * the session lives, and a protected page should show the server's word.
 */
export function AccountPage() {
  useDocumentTitle("Akun saya — GoShop");
  const { session, authApi } = useSession();
  // RequireAuth renders this page only when someone is logged in.
  const userId = session?.user.id ?? "";
  const {
    data: user,
    status,
    error,
    isFetching,
    refetch,
  } = useQuery({
    ...meQuery(authApi, userId),
    enabled: session !== null,
  });

  return (
    <Card>
      <h1 tabIndex={-1} className="mb-4">
        Akun saya
      </h1>
      {(status === "pending" || (status === "error" && isFetching)) && (
        <LoadingState>Memuat akun…</LoadingState>
      )}
      {status === "error" && !isFetching && (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      )}
      {status === "success" && (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Nama</dt>
          <dd>{user.name}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>
            {user.email}
            {!user.email_verified && (
              <span className="text-muted-foreground">
                {" "}
                (belum diverifikasi)
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">Telepon</dt>
          <dd>{user.phone ?? "Belum diisi"}</dd>
          <dt className="text-muted-foreground">Bergabung</dt>
          <dd>{dateFormat.format(new Date(user.created_at))}</dd>
        </dl>
      )}
    </Card>
  );
}
