package auth

import (
	"net/http"
	"slices"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// RequireRole lets a request through only when the caller's role is one of
// roles; any other logged-in caller gets 403 FORBIDDEN. It must run after
// Guard.Authenticate: without its claims the request gets 401, so a route
// mounted in the wrong place fails closed instead of open.
//
// The role comes from the access token, so a role change reaches the
// caller at their next refresh (ADR 0005).
func RequireRole(roles ...user.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := ClaimsFrom(r.Context())
			if !ok {
				writeUnauthorized(w, r, httpapi.UnauthorizedError("missing access token"))
				return
			}
			if !slices.Contains(roles, claims.Role) {
				httpapi.Error(w, r, httpapi.ForbiddenError())
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
