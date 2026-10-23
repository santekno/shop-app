package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"

	"github.com/santekno/sdk/hashx"
	"github.com/santekno/sdk/uuidx"
)

// secretBytes is the length of an opaque token's secret: 256 random bits,
// far beyond guessing, which is why a fast hash (SHA-256) is enough to
// store it, unlike a password.
const secretBytes = 32

// opaqueToken is a refresh, email-verification or password-reset token,
// shaped "<id>.<secret>" (ADR 0005). The id finds the row; the secret
// proves possession. Only the secret's SHA-256 is stored.
type opaqueToken struct {
	// ID is the row's UUIDv7, the part before the dot.
	ID string
	// Hash is SHA-256 of the secret, what the row stores.
	Hash []byte
}

// newOpaqueToken makes a token with a new id from newID and a secret read
// from random (crypto/rand.Reader in the API). It returns the string to hand
// to the client, once, and what to store.
func newOpaqueToken(random io.Reader, newID func() string) (string, opaqueToken, error) {
	secret := make([]byte, secretBytes)
	if _, err := io.ReadFull(random, secret); err != nil {
		return "", opaqueToken{}, fmt.Errorf("read random token: %w", err)
	}
	t := opaqueToken{ID: newID(), Hash: hashSecret(secret)}
	return t.ID + "." + base64.RawURLEncoding.EncodeToString(secret), t, nil
}

// parseOpaqueToken splits s into the row id and the hash of its secret.
// ok is false for anything this API could not have issued, so a malformed
// token is refused without a database query.
func parseOpaqueToken(s string) (opaqueToken, bool) {
	id, encoded, found := strings.Cut(s, ".")
	if !found || !uuidx.IsValidUUID(id) {
		return opaqueToken{}, false
	}
	secret, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(secret) != secretBytes {
		return opaqueToken{}, false
	}
	return opaqueToken{ID: id, Hash: hashSecret(secret)}, true
}

// matches reports whether stored, a hash from the database, is the hash of
// this token's secret. The comparison takes the same time wherever the two
// differ, so response times do not leak how much of a guess was right.
func (t opaqueToken) matches(stored []byte) bool {
	return hashx.ConstantTimeEqual(t.Hash, stored)
}

func hashSecret(secret []byte) []byte {
	sum := sha256.Sum256(secret)
	return sum[:]
}
