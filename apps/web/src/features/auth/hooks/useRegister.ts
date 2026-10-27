import { useMutation } from "@tanstack/react-query";
import { register } from "@goshop/shared";
import type { RegisterRequest } from "@goshop/shared";
import { api } from "@/lib/api.ts";

/**
 * POST /v1/auth/register as a mutation: the new account, not logged in.
 * gcTime 0: the finished mutation, whose `variables` hold the password,
 * leaves the MutationCache as soon as the page is left (see useLogin).
 */
export const useRegister = () =>
  useMutation({
    gcTime: 0,
    mutationFn: (account: RegisterRequest) => register(api, account),
  });
