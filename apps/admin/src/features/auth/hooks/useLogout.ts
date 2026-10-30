import { useMutation } from "@tanstack/react-query";
import { useSession } from "../session-context.ts";

/**
 * Logging out as a mutation: POST /v1/auth/web/logout, then the session
 * is forgotten here and RequireStaff sends the browser to /masuk.
 *
 * When the API cannot confirm the logout (the network, a 500 that kept the
 * cookie), the session stays, and `isError` lets the caller say so: a
 * dashboard that looked logged out while a reload brings the session back
 * would be worse than an honest "Gagal keluar".
 */
export const useLogout = () => {
  const { logout } = useSession();
  return useMutation({ mutationFn: logout });
};
