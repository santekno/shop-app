package cart

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"

	"github.com/santekno/sdk/hashx"
	"github.com/santekno/sdk/uuidx"
)

// HeaderToken is the request and response header that carries a guest
// cart's token (ADR 0006). A header, not a cookie: the mobile app has no
// cookie jar, and a browser never sends a header on its own, so a guest
// cart needs no CSRF protection.
const HeaderToken = "X-Cart-Token" // #nosec G101 -- the header's name, not a credential

// tokenSecretBytes is the length of a guest token's secret: 256 random
// bits, so SHA-256 is enough to store it (it cannot be guessed).
const tokenSecretBytes = 32

// guestToken is a guest cart's token, "<cart id>.<secret>": the shape of
// ADR 0005's opaque tokens. The id finds the row; only the SHA-256 of the
// secret is stored.
type guestToken struct {
	CartID string
	Hash   []byte
}

// newGuestToken makes a token for a new cart with id cartID, with a secret
// read from random (crypto/rand.Reader in the API). It returns the string
// to hand to the client, once, and what to store.
func newGuestToken(random io.Reader, cartID string) (string, guestToken, error) {
	secret := make([]byte, tokenSecretBytes)
	if _, err := io.ReadFull(random, secret); err != nil {
		return "", guestToken{}, fmt.Errorf("read random cart token: %w", err)
	}
	sum := sha256.Sum256(secret)
	return cartID + "." + base64.RawURLEncoding.EncodeToString(secret), guestToken{CartID: cartID, Hash: sum[:]}, nil
}

// parseGuestToken splits s into the cart id and the hash of its secret; ok
// is false for anything this API could not have issued, so a malformed
// token costs no query.
func parseGuestToken(s string) (guestToken, bool) {
	id, encoded, found := strings.Cut(s, ".")
	if !found || !uuidx.IsValidUUID(id) {
		return guestToken{}, false
	}
	secret, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(secret) != tokenSecretBytes {
		return guestToken{}, false
	}
	sum := sha256.Sum256(secret)
	return guestToken{CartID: id, Hash: sum[:]}, true
}

// matches compares stored, the row's hash, with the token's in constant
// time.
func (t guestToken) matches(stored []byte) bool {
	return hashx.ConstantTimeEqual(t.Hash, stored)
}
