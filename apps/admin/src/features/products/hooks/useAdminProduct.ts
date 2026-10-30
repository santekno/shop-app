import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-context.ts";
import { adminProductQuery } from "../api/queries.ts";

/** The product with this ID, any status, fetched as the logged-in user. */
export const useAdminProduct = (id: string) => {
  const { authApi } = useSession();
  return useQuery(adminProductQuery(authApi, id));
};
