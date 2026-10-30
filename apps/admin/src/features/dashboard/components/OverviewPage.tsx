import { Link } from "react-router";
import { NAV_ITEMS } from "@/app/navigation.ts";
import { PageHeader } from "@/components/PageHeader.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { roleLabel } from "@/features/auth/roles.ts";
import { useSessionUser } from "@/features/auth/session-context.ts";
import { RecentSalesTile } from "@/features/reports/components/RecentSalesTile.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/**
 * "/", the first page after a login: a greeting with the user's role, and
 * a card per section of the dashboard. The cards come from the sidebar's
 * NAV_ITEMS, so a new section appears here without a second list.
 */
export function OverviewPage() {
  useDocumentTitle("Ringkasan — GoShop Admin");
  const user = useSessionUser();
  const sections = NAV_ITEMS.filter((item) => item.to !== "/");

  return (
    <>
      <PageHeader
        title="Ringkasan"
        description={`Halo, ${user.name}. Anda masuk sebagai ${roleLabel(user.role)}.`}
      />
      <RecentSalesTile />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map(({ to, label, icon: Icon, description }) => (
          <li key={to}>
            <Card className="h-full">
              <h2 className="mb-2 flex items-center gap-2">
                <Icon aria-hidden="true" className="size-5 text-primary" />
                <Link to={to}>{label}</Link>
              </h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
