import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-context.ts";
import { adminOrderQuery } from "../api/queries.ts";

/** Any buyer's order with this ID, fetched as the logged-in user. */
export const useAdminOrder = (id: string) => {
  const { authApi } = useSession();
  return useQuery(adminOrderQuery(authApi, id));
};
