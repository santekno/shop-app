// The accounts and rate limits the suite needs, prepared once before it
// runs (global-setup.ts) against the Compose stack's own API, Postgres and
// Redis. Local development data only: the stack's fixed credentials never
// reach a real deployment.
import { API_URL, compose } from "./stack.ts";

/**
 * The buyer the login specs sign in with: registered through the real API,
 * then marked verified, as a buyer who clicked the email link would be.
 * The password is a fixture for the local stack, not a secret.
 */
export const BUYER = {
  name: "Pembeli E2E",
  email: "e2e-buyer@goshop.local",
  password: "kopi-tubruk-e2e-2026",
} as const;

/**
 * Rate-limit counters of the API live in Redis under goshop:rl:* (auth's
 * limits and the guest-cart limit). Register allows 10 per hour per IP and
 * new guest carts 30, and every request from the browser comes from the
 * same Docker gateway address, so a second run of the suite within the
 * hour would hit them. Clearing the counters of the local stack makes each
 * run start from the same state.
 */
export const clearRateLimits = (): void => {
  compose(
    "exec",
    "-T",
    "redis",
    "sh",
    "-c",
    "redis-cli --scan --pattern 'goshop:rl:*' | xargs -r redis-cli del > /dev/null",
  );
};

/** Registers BUYER (once; EMAIL_TAKEN on later runs) and verifies the email. */
export const ensureBuyer = async (): Promise<void> => {
  const response = await fetch(`${API_URL}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(BUYER),
  });
  if (response.status !== 201 && response.status !== 409) {
    throw new Error(
      `register ${BUYER.email}: HTTP ${response.status} ${await response.text()}`,
    );
  }
  // What clicking the verification link does (email_verified_at), without
  // a mailbox: the address is a fixed local one, so no quoting is needed.
  compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "goshop",
    "-d",
    "goshop",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE email = '${BUYER.email}'`,
  );
};
