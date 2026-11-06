// WHERE THE BUYER'S ACCESS TOKEN COMES FROM: a seam, deliberately empty.
//
// The wishlist endpoints (/v1/me/wishlist) need a buyer's bearer token, and
// the app has no sign-in yet. Rather than faking one, the wishlist feature
// asks this one function for a token every time it is about to make a
// request, and does nothing (and says "Masuk dulu…") when it answers null.
//
// Bab 15 replaces the body with a read of the session kept in
// expo-secure-store (Keychain / Keystore), and nothing else in the wishlist
// feature changes. Two rules for that replacement:
//
//   - the token is never copied into the query cache, a mutation's
//     variables or AsyncStorage: it is read here, at the moment of the
//     request, and used for that request's Authorization header only;
//   - it must stay synchronous for the callers in this feature, so Bab 15
//     keeps the session in memory after reading it once at start-up (a
//     small store), instead of reading secure-store on every press.
//
// When the user signs out (Bab 15), also call
// `queryClient.removeQueries({ queryKey: queryKeys.wishlist.all })`, so the
// next buyer on the phone never sees the previous one's hearts.

/** The access token of the signed-in buyer, or null when nobody is. */
export const getAccessToken = (): string | null => null;
