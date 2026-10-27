import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAddress } from "@goshop/shared";
import type { AddressCreate } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { checkoutKeys } from "../api/queries.ts";

/**
 * Adds an address to the logged-in buyer's book (POST /v1/me/addresses).
 *
 * Not optimistic: the API decides which address is the default (the
 * first one always is) and in what order the list comes back. On success
 * the list is fetched again, and the mutation settles only after that
 * refetch (onSuccess returns its promise), so the caller can select the
 * new address and find it in the list it renders.
 */
export const useCreateAddress = (userId: string) => {
  const queryClient = useQueryClient();
  const { authApi } = useSession();
  return useMutation({
    mutationFn: (address: AddressCreate) => createAddress(authApi, address),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: checkoutKeys.addresses(userId),
      }),
  });
};
