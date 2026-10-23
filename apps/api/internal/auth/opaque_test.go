package auth

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"
)

func TestNewOpaqueToken(t *testing.T) {
	raw, tok, err := newOpaqueToken(zeroReader{}, func() string { return id1 })
	testx.AssertNoError(t, err)

	// "<uuid>.<base64url of 32 bytes>", the id first.
	id, secret, found := strings.Cut(raw, ".")
	testx.AssertTrue(t, found, "no dot in %q", raw)
	testx.AssertEqual(t, id, id1)
	testx.AssertEqual(t, tok.ID, id1)
	testx.AssertEqual(t, secret, base64.RawURLEncoding.EncodeToString(make([]byte, 32)))
	testx.AssertEqual(t, len(secret), 43, "32 bytes, base64url without padding")

	// Only the SHA-256 of the secret is kept, never the secret.
	want := sha256.Sum256(make([]byte, 32))
	testx.AssertTrue(t, bytes.Equal(tok.Hash, want[:]), "hash = %x", tok.Hash)

	// It parses back to the same id and hash.
	parsed, ok := parseOpaqueToken(raw)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, parsed.ID, tok.ID)
	testx.AssertTrue(t, bytes.Equal(parsed.Hash, tok.Hash))
	testx.AssertTrue(t, parsed.matches(tok.Hash))
}

func TestNewOpaqueToken_RealRandomnessDiffers(t *testing.T) {
	a, ta, err := newOpaqueToken(rand.Reader, uuidx.NewV7)
	testx.AssertNoError(t, err)
	b, tb, err := newOpaqueToken(rand.Reader, uuidx.NewV7)
	testx.AssertNoError(t, err)
	testx.AssertNotEqual(t, a, b)
	testx.AssertNotEqual(t, ta.ID, tb.ID)
	testx.AssertFalse(t, bytes.Equal(ta.Hash, tb.Hash))
}

func TestNewOpaqueToken_RandomFails(t *testing.T) {
	raw, tok, err := newOpaqueToken(failingReader{}, func() string {
		t.Fatal("no id is made when there is no secret")
		return ""
	})
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "read random token: ")
	testx.AssertEqual(t, raw, "")
	testx.AssertEqual(t, tok.ID, "")
}

func TestParseOpaqueToken_Refusals(t *testing.T) {
	secret := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	tests := []struct {
		name  string
		token string
	}{
		{name: "empty", token: ""},
		{name: "no dot", token: id1 + secret},
		{name: "id only", token: id1 + "."},
		{name: "secret only", token: "." + secret},
		{name: "id is not a UUID", token: "not-a-uuid." + secret},
		{name: "id is a number", token: "42." + secret},
		{name: "secret is not base64url", token: id1 + ".!!!!"},
		{name: "secret uses padding", token: id1 + "." + base64.URLEncoding.EncodeToString(make([]byte, 32))},
		{name: "secret uses std alphabet", token: id1 + "." + strings.Repeat("+", 43)},
		{name: "secret too short", token: id1 + "." + base64.RawURLEncoding.EncodeToString(make([]byte, 31))},
		{name: "secret too long", token: id1 + "." + base64.RawURLEncoding.EncodeToString(make([]byte, 33))},
		{name: "a second dot", token: id1 + "." + secret + ".x"},
		{name: "a JWT", token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln"}, //nolint:gosec // a test value, not a credential
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tok, ok := parseOpaqueToken(tt.token)
			testx.AssertFalse(t, ok, "parseOpaqueToken(%q) accepted", tt.token)
			testx.AssertEqual(t, tok.ID, "")
			testx.AssertEqual(t, len(tok.Hash), 0)
		})
	}
}

func TestOpaqueToken_Matches(t *testing.T) {
	_, tok, err := newOpaqueToken(zeroReader{}, func() string { return id1 })
	testx.AssertNoError(t, err)

	same := append([]byte(nil), tok.Hash...)
	firstByte := append([]byte(nil), tok.Hash...)
	firstByte[0] ^= 1
	lastByte := append([]byte(nil), tok.Hash...)
	lastByte[len(lastByte)-1] ^= 1

	testx.AssertTrue(t, tok.matches(same), "the stored hash of this secret")
	testx.AssertFalse(t, tok.matches(firstByte), "differs in the first byte")
	testx.AssertFalse(t, tok.matches(lastByte), "differs in the last byte")
	testx.AssertFalse(t, tok.matches(tok.Hash[:31]), "a prefix of the hash")
	testx.AssertFalse(t, tok.matches(nil), "no stored hash")
}

// The comparison must take the same time wherever the hashes differ. Timing
// cannot be measured reliably in a unit test, so this guards the one line
// that gives that property: matches compares with hashx.ConstantTimeEqual,
// not bytes.Equal or ==, which stop at the first difference.
func TestOpaqueToken_MatchesIsConstantTime(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "opaque.go", nil, 0)
	testx.AssertNoError(t, err)
	var calls []string
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "matches" {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok {
				if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
					if pkg, ok := sel.X.(*ast.Ident); ok {
						calls = append(calls, pkg.Name+"."+sel.Sel.Name)
					}
				}
			}
			if bin, ok := n.(*ast.BinaryExpr); ok && (bin.Op == token.EQL || bin.Op == token.NEQ) {
				calls = append(calls, "operator "+bin.Op.String())
			}
			return true
		})
	}
	testx.AssertEqual(t, strings.Join(calls, ","), "hashx.ConstantTimeEqual",
		"matches must compare only with hashx.ConstantTimeEqual")
}
