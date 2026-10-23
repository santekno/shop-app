package cart

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

const guestCartID = "0190c8a0-0000-7000-8000-0000000000c1"

// secret is a 32-byte secret of b repeated.
func secret(b byte) []byte { return bytes.Repeat([]byte{b}, tokenSecretBytes) }

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errBoom }

func TestNewGuestToken(t *testing.T) {
	token, stored, err := newGuestToken(bytes.NewReader(secret(7)), guestCartID)
	testx.AssertNoError(t, err)

	id, encoded, ok := strings.Cut(token, ".")
	testx.AssertTrue(t, ok, "token %q has the <id>.<secret> shape", token)
	testx.AssertEqual(t, id, guestCartID)
	testx.AssertEqual(t, encoded, base64.RawURLEncoding.EncodeToString(secret(7)))
	testx.AssertEqual(t, len(encoded), 43, "32 bytes, base64url without padding")
	sum := sha256.Sum256(secret(7))
	testx.AssertEqual(t, stored.CartID, guestCartID)
	testx.AssertTrue(t, bytes.Equal(stored.Hash, sum[:]), "only the SHA-256 of the secret is stored")
	testx.AssertFalse(t, strings.Contains(string(stored.Hash), string(secret(7))), "the secret itself is not stored")

	// What it issues, it accepts.
	parsed, ok := parseGuestToken(token)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, parsed.CartID, guestCartID)
	testx.AssertTrue(t, parsed.matches(stored.Hash))

	t.Run("a different secret is a different token", func(t *testing.T) {
		other, _, err := newGuestToken(bytes.NewReader(secret(8)), guestCartID)
		testx.AssertNoError(t, err)
		testx.AssertNotEqual(t, other, token)
		p, _ := parseGuestToken(other)
		testx.AssertFalse(t, p.matches(stored.Hash))
	})
	t.Run("random fails", func(t *testing.T) {
		token, _, err := newGuestToken(failingReader{}, guestCartID)
		testx.AssertError(t, err)
		testx.AssertEqual(t, err.Error(), "read random cart token: boom")
		testx.AssertEqual(t, token, "")
	})
	t.Run("random runs short", func(t *testing.T) {
		_, _, err := newGuestToken(bytes.NewReader(make([]byte, tokenSecretBytes-1)), guestCartID)
		testx.AssertError(t, err)
		testx.AssertContains(t, err.Error(), "read random cart token: ")
	})
}

func TestParseGuestToken(t *testing.T) {
	good := guestCartID + "." + base64.RawURLEncoding.EncodeToString(secret(1))
	sum := sha256.Sum256(secret(1))
	tok, ok := parseGuestToken(good)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, tok.CartID, guestCartID)
	testx.AssertTrue(t, bytes.Equal(tok.Hash, sum[:]))

	bad := []struct {
		name  string
		token string
	}{
		{name: "empty", token: ""},
		{name: "no dot", token: guestCartID + base64.RawURLEncoding.EncodeToString(secret(1))},
		{name: "id is not a UUID", token: "cart-1." + base64.RawURLEncoding.EncodeToString(secret(1))},
		{name: "no id", token: "." + base64.RawURLEncoding.EncodeToString(secret(1))},
		{name: "no secret", token: guestCartID + "."},
		{name: "padded base64", token: guestCartID + "." + base64.URLEncoding.EncodeToString(secret(1))},
		{name: "standard alphabet", token: guestCartID + "." + base64.RawStdEncoding.EncodeToString(bytes.Repeat([]byte{0xfb, 0xff}, 16))},
		{name: "secret too short", token: guestCartID + "." + base64.RawURLEncoding.EncodeToString(secret(1)[:31])},
		{name: "secret too long", token: guestCartID + "." + base64.RawURLEncoding.EncodeToString(append(secret(1), 1))},
		{name: "a second dot", token: good + ".x"},
		{name: "spaces around it", token: " " + good},
	}
	for _, tt := range bad {
		t.Run(tt.name, func(t *testing.T) {
			tok, ok := parseGuestToken(tt.token)
			testx.AssertFalse(t, ok, "token %q", tt.token)
			testx.AssertEqual(t, tok.CartID, "")
			testx.AssertEqual(t, len(tok.Hash), 0)
		})
	}
}

func TestGuestToken_Matches(t *testing.T) {
	sum := sha256.Sum256(secret(3))
	tok := guestToken{CartID: guestCartID, Hash: sum[:]}
	testx.AssertTrue(t, tok.matches(sum[:]))
	other := sha256.Sum256(secret(4))
	testx.AssertFalse(t, tok.matches(other[:]))
	testx.AssertFalse(t, tok.matches(nil), "a row without a hash (a user's cart) never matches")
	testx.AssertFalse(t, tok.matches(sum[:31]), "a prefix is not a match")
}
