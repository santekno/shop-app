import { useMutation } from "@tanstack/react-query";
import { login } from "@goshop/shared";
import type { LoginRequest } from "@goshop/shared";
import { api } from "@/lib/api.ts";
import { useSession } from "../session-context.ts";
import type { Session } from "../session-context.ts";

/**
 * POST /v1/auth/login as a mutation. On success the account and the
 * access token go into the in-memory session.
 *
 * The refresh token in the answer is dropped inside mutationFn, before
 * TanStack Query sees the result (see useSession for why Bab 9 keeps
 * none). Whatever mutationFn returns is kept as the mutation's `data`, in
 * the hook and in the MutationCache until gcTime ends; dropping it later,
 * in onSuccess, would leave a copy there.
 *
 * The same cache also keeps the mutation's `variables`, here the email and
 * the password. gcTime 0 drops the finished mutation as soon as no
 * component shows it (the login page is left), instead of after the
 * default five minutes.
 */
export const useLogin = () => {
  const { setSession } = useSession();
  return useMutation({
    gcTime: 0,
    mutationFn: async (credentials: LoginRequest): Promise<Session> => {
      const tokens = await login(api, credentials);
      return { user: tokens.user, accessToken: tokens.access_token };
    },
    onSuccess: (session) => {
      setSession(session);
    },
  });
};
