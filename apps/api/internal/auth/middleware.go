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
	access *AccessTokens
	jwt    func(http.Handler) http.Handler
}

// NewGuard returns a Guard that accepts access tokens issued by access.
func NewGuard(access *AccessTokens) *Guard {
	return &Guard{
		access: access,
		// sdk JWTAuth reads "Authorization: Bearer <token>" and verifies
		// the signature, the algorithm and exp with jwtx. Its 401 goes
		// through httpapi, so it has the API's error body and logging.
		jwt: sdkmw.JWTAuth(access.Key(), sdkmw.WithErrorWriter(writeUnauthorized)),
	}
}

// Authenticate is the middleware for every route that needs a logged-in
// user. After sdk JWTAuth it checks the claims this API requires
// (AccessTokens.Check), stores them for ClaimsFrom and RequireRole, and
// adds user_id to the request's logger.
func (g *Guard) Authenticate(next http.Handler) http.Handler {
	return g.jwt(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := sdkmw.ClaimsFromContext(r.Context())
		claims, err := g.access.Check(raw)
		if err != nil {
			writeUnauthorized(w, r, httpapi.UnauthorizedError("invalid or expired token"))
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
