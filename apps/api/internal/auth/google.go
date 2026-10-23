package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// ProviderGoogle is the provider name stored in user_identities.
const ProviderGoogle = "google"

// googleJWKSURL is where Google publishes the keys that sign its ID tokens.
const googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

// ErrGoogleTokenInvalid means a Google ID token failed verification.
var ErrGoogleTokenInvalid = errors.New("google id token invalid")

// GoogleIdentity is what a verified Google ID token says about its user.
type GoogleIdentity struct {
	// Subject is Google's stable, unique id for the account ("sub").
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

// GoogleVerifier checks a Google ID token. The API uses OIDCGoogleVerifier;
// a test passes a fake that returns a fixed identity, because a real token
// needs a real Google account.
type GoogleVerifier interface {
	Verify(ctx context.Context, rawIDToken string) (GoogleIdentity, error)
}

// OIDCGoogleVerifier verifies Google ID tokens with github.com/coreos/go-oidc:
// the RS256 signature against Google's published keys (fetched once, cached,
// and fetched again when Google rotates them), the issuer
// (https://accounts.google.com, or accounts.google.com, which Google also
// uses), the audience (our OAuth client ID, so a token Google issued to
// another app is refused) and the expiry.
type OIDCGoogleVerifier struct {
	verifier *oidc.IDTokenVerifier
}

// NewGoogleVerifier returns a verifier for tokens issued to clientID
// (GOOGLE_CLIENT_ID). now is the clock for the expiry check (nil:
// time.Now). It makes no network call; the keys are fetched on first use,
// with a 10-second timeout.
func NewGoogleVerifier(clientID string, now func() time.Time) *OIDCGoogleVerifier {
	// go-oidc fetches keys with the client in this context; the default one
	// has no timeout.
	ctx := oidc.ClientContext(context.Background(), &http.Client{Timeout: 10 * time.Second})
	keys := oidc.NewRemoteKeySet(ctx, googleJWKSURL)
	return &OIDCGoogleVerifier{verifier: oidc.NewVerifier("https://accounts.google.com", keys, &oidc.Config{
		ClientID:             clientID,
		SupportedSigningAlgs: []string{oidc.RS256},
		Now:                  now,
	})}
}

// Verify implements GoogleVerifier. Every failure is ErrGoogleTokenInvalid,
// with go-oidc's reason wrapped for the log.
func (v *OIDCGoogleVerifier) Verify(ctx context.Context, rawIDToken string) (GoogleIdentity, error) {
	tok, err := v.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return GoogleIdentity{}, fmt.Errorf("%w: %w", ErrGoogleTokenInvalid, err)
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := tok.Claims(&claims); err != nil {
		return GoogleIdentity{}, fmt.Errorf("%w: read claims: %w", ErrGoogleTokenInvalid, err)
	}
	if tok.Subject == "" {
		return GoogleIdentity{}, fmt.Errorf("%w: no subject", ErrGoogleTokenInvalid)
	}
	return GoogleIdentity{
		Subject: tok.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified, Name: claims.Name,
	}, nil
}
