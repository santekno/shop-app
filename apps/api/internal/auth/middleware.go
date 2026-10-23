package auth

import (
	"context"
	"net/http"

	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/logx"
	sdkmw "github.com/santekno/sdk/middleware/chi"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

type claimsKey struct{}

// Guard turns the access token of a request into a known user, or ends the
// request with 401 UNAUTHORIZED.
type Guard struct {
	access  *AccessTokens
	revoked SessionRevocations
	jwt     func(http.Handler) http.Handler
}

// NewGuard returns a Guard that accepts access tokens issued by access,
// unless their session is in revoked.
func NewGuard(access *AccessTokens, revoked SessionRevocations) *Guard {
	return &Guard{
		access:  access,
		revoked: revoked,
		// sdk JWTAuth reads "Authorization: Bearer <token>" and verifies
		// the signature, the algorithm and exp with jwtx. Its 401 goes
		// through httpapi, so it has the API's error body and logging.
		jwt: sdkmw.JWTAuth(access.Key(), sdkmw.WithErrorWriter(writeUnauthorized)),
	}
}

// Authenticate is the middleware for every route that needs a logged-in
// user. After sdk JWTAuth it checks the claims this API requires
// (AccessTokens.Check) and that the token's session has not been revoked
// (logout, a reused refresh token, a password reset, account deletion),
// stores the claims for ClaimsFrom and RequireRole, and adds user_id to the
// request's logger.
//
// When Redis cannot answer, the request fails with 500 instead of letting
// a possibly revoked token through (fail closed). /readyz reports redis
// unavailable at the same time; Railway checks it only while a deployment
// starts, so a new deployment waits for Redis, and a load balancer that
// polls it would also stop routing to this instance.
func (g *Guard) Authenticate(next http.Handler) http.Handler {
	return g.jwt(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := sdkmw.ClaimsFromContext(r.Context())
		claims, err := g.access.Check(raw)
		if err != nil {
			writeUnauthorized(w, r, httpapi.UnauthorizedError("invalid or expired token"))
			return
		}
		revoked, err := g.revoked.IsRevoked(r.Context(), claims.SessionID)
		if err != nil {
			httpapi.Error(w, r, err)
			return
		}
		if revoked {
			writeUnauthorized(w, r, httpapi.UnauthorizedError("this session has ended; log in again"))
			return
		}
		next.ServeHTTP(w, r.WithContext(withClaims(r.Context(), claims)))
	}))
}

// withClaims stores claims in ctx, with the user ID where sdk ctxx and the
// logger look for it.
func withClaims(ctx context.Context, claims AccessClaims) context.Context {
	ctx = context.WithValue(ctx, claimsKey{}, claims)
	ctx = ctxx.WithUserID(ctx, claims.UserID)
	return logx.WithContextLogger(ctx, logx.FromContext(ctx).With("user_id", claims.UserID))
}

// ClaimsFrom returns the claims Authenticate accepted for this request.
func ClaimsFrom(ctx context.Context) (AccessClaims, bool) {
	c, ok := ctx.Value(claimsKey{}).(AccessClaims)
	return c, ok
}

// writeUnauthorized writes a 401 through httpapi.Error, which adds the
// WWW-Authenticate header RFC 6750 asks for to every UNAUTHORIZED, so a
// client knows a Bearer token is expected. It is also sdk JWTAuth's error
// writer.
func writeUnauthorized(w http.ResponseWriter, r *http.Request, err *errx.AppError) {
	httpapi.Error(w, r, err)
}
