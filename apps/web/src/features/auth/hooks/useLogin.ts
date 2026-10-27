import { useMutation } from "@tanstack/react-query";
import type { LoginRequest } from "@goshop/shared";
import { useSession } from "../session-context.ts";

/**
 * Logging in as a mutation: POST /v1/auth/web/login through the session
 * (useSession().login), which keeps the access token in memory, lets the
 * browser store the refresh token in its httpOnly cookie, and merges the
 * guest cart.
 *
 * mutationFn returns nothing: whatever it returns is kept as the
 * mutation's `data`, in the hook and in the MutationCache until gcTime
 * ends, and the access token has no business there.
 *
 * The same cache also keeps the mutation's `variables`, here the email and
 * the password. gcTime 0 drops the finished mutation as soon as no
 * component shows it (the login page is left), instead of after the
 * default five minutes.
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
