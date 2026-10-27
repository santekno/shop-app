/**
 * The state RegisterPage puts on its navigation to /masuk, so the login
 * form can say the account exists and fill in its email.
 */
export const registeredState = (email: string) => ({ registeredEmail: email });

/** The email from registeredState, if `state` is one. `state` is
 *  history.state: anything can be in it, so it is checked, not cast. */
export const registeredEmailFrom = (state: unknown): string | undefined =>
  typeof state === "object" &&
  state !== null &&
  "registeredEmail" in state &&
  typeof state.registeredEmail === "string"
    ? state.registeredEmail
    : undefined;
