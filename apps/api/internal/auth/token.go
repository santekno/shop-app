package auth

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/santekno/sdk/jwtx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The fixed claims of every access token. A token from another issuer or
// for another audience is refused even when its signature is valid, so a
// key shared by mistake with another service cannot mint GoShop tokens.
const (
	Issuer   = "goshop-api"
	Audience = "goshop"
)

// ErrInvalidToken means an access token's claims are not the ones this API
// issues. The middleware answers it with 401, like a bad signature.
var ErrInvalidToken = errors.New("invalid access token")

// AccessClaims is what an access token says about its holder.
type AccessClaims struct {
	// UserID is the "sub" claim.
	UserID string
	// Role is the "role" claim, the user's role when the token was issued.
	Role user.Role
	// TokenID is the "jti" claim, a UUIDv7 unique to this token.
	TokenID   string
	IssuedAt  time.Time
	ExpiresAt time.Time
}

// AccessTokens issues and checks the JWT access tokens of ADR 0005: HS256
// through sdk jwtx, signed with JWT_SECRET.
type AccessTokens struct {
	key   jwtx.Key
	ttl   time.Duration
	now   func() time.Time
	newID func() string
}

// NewAccessTokens returns an issuer that signs with secret and gives every
// token ttl to live. now is the clock (time.Now in the API); a test passes
// its own, near the real time, because jwtx checks "exp" against the wall
// clock as well (see docs/sdk-gaps.md).
func NewAccessTokens(secret []byte, ttl time.Duration, now func() time.Time) *AccessTokens {
	if now == nil {
		now = time.Now
	}
	return &AccessTokens{key: jwtx.HS256(secret), ttl: ttl, now: now, newID: uuidx.NewV7}
}

// Key is the verification key, for sdk middleware/chi JWTAuth.
func (t *AccessTokens) Key() jwtx.Key { return t.key }

// Issue signs a new access token for u.
func (t *AccessTokens) Issue(u user.User) (string, AccessClaims, error) {
	// JWT times are whole seconds; truncating here makes the returned
	// claims equal to what Verify reads back.
	now := t.now().Truncate(time.Second)
	c := AccessClaims{
		UserID:    u.ID,
		Role:      u.Role,
		TokenID:   t.newID(),
		IssuedAt:  now,
		ExpiresAt: now.Add(t.ttl),
	}
	token, err := jwtx.Sign(jwtx.Claims{
		Subject:   c.UserID,
		Issuer:    Issuer,
		Audience:  []string{Audience},
		IssuedAt:  c.IssuedAt,
		ExpiresAt: c.ExpiresAt,
		ID:        c.TokenID,
		Extra:     map[string]any{"role": string(c.Role)},
	}, t.key)
	if err != nil {
		return "", AccessClaims{}, fmt.Errorf("sign access token: %w", err)
	}
	return token, c, nil
}

// Check validates the claims of a token whose signature jwtx has already
// verified (sdk JWTAuth does that) and returns them typed. jwtx checks the
// algorithm, the signature and "exp" when it is present; Check adds what
// jwtx leaves to the application: issuer, audience, an "exp" that must
// exist, a subject, a known role, and expiry against this issuer's clock.
func (t *AccessTokens) Check(c *jwtx.Claims) (AccessClaims, error) {
	if c == nil || c.Issuer != Issuer || !slices.Contains(c.Audience, Audience) ||
		c.Subject == "" || c.ID == "" || c.ExpiresAt.IsZero() || c.IssuedAt.IsZero() {
		return AccessClaims{}, ErrInvalidToken
	}
	if !t.now().Before(c.ExpiresAt) {
		return AccessClaims{}, ErrInvalidToken
	}
	role, _ := c.Extra["role"].(string)
	if !user.Role(role).Valid() {
		return AccessClaims{}, ErrInvalidToken
	}
	return AccessClaims{
		UserID:    c.Subject,
		Role:      user.Role(role),
		TokenID:   c.ID,
		IssuedAt:  c.IssuedAt,
		ExpiresAt: c.ExpiresAt,
	}, nil
}
