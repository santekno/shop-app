import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-context.ts";
import { productTableQuery } from "../api/queries.ts";
import { toListAdminProductsQuery } from "../product-table-params.ts";
import type { ProductTableParams } from "../product-table-params.ts";

/**
 * The page of the product table that `params` asks for, fetched as the
 * logged-in user. The previous page stays as placeholder data while the
 * next one loads (productTableQuery): `isPlaceholderData` is true then.
 */
export const useProductTable = (params: ProductTableParams) => {
  const { authApi } = useSession();
  return useQuery(productTableQuery(authApi, toListAdminProductsQuery(params)));
};
