import { useMutation } from "@tanstack/react-query";
import type { LoginRequest } from "@goshop/shared";
import { useSession } from "../session-context.ts";

/**
 * Logging in as a mutation: POST /v1/auth/web/login through the session
 * (useSession().login).
 *
 * mutationFn returns nothing, so the access token never lands in the
 * mutation's `data`; gcTime 0 drops the finished mutation, and with it the
 * email and password in its `variables`, as soon as the login page is left.
 */
export const useLogin = () => {
  const { login } = useSession();
  return useMutation({
    gcTime: 0,
    mutationFn: async (credentials: LoginRequest): Promise<void> => {
      await login(credentials);
    },
  });
};
