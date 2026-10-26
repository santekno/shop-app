package midtrans

import (
	"crypto/sha512"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// knownSignature is SHA-512("GS-1-ABC" + "200" + "117000.00" +
// "SB-Mid-server-x") in hex, computed once outside Go (shasum -a 512).
const knownSignature = "9acd0234dd26029fb952e47b12c3bd58ce06c0a2b425b8c79f805fe6a70b650d" +
	"21908d0c12dbe1f24774de2d90e9b3e8856bfcd4f01550a48f52fafee142a28e"

func TestSignature_KnownVector(t *testing.T) {
	got := Signature("SB-Mid-server-x", "GS-1-ABC", "200", "117000.00")
	testx.AssertEqual(t, got, knownSignature)
	testx.AssertEqual(t, len(got), 128)
}

func TestSignature_IsSHA512OfTheFieldsInOrder(t *testing.T) {
	tests := []struct{ key, orderID, code, amount string }{
		{testServerKey, "GS-20261101-7KQ2M9-K3D9QX", "200", "117000.00"},
		{testServerKey, "GS-1", "407", "1.00"},
		{"another-key", "GS-2", "201", "999999.00"},
		{"", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.orderID+"/"+tt.code, func(t *testing.T) {
			sum := sha512.Sum512([]byte(tt.orderID + tt.code + tt.amount + tt.key))
			testx.AssertEqual(t, Signature(tt.key, tt.orderID, tt.code, tt.amount), hex.EncodeToString(sum[:]))
		})
	}
	// The key is last: moving it first gives another value.
	first := sha512.Sum512([]byte("SB-Mid-server-x" + "GS-1-ABC" + "200" + "117000.00"))
	testx.AssertNotEqual(t, Signature("SB-Mid-server-x", "GS-1-ABC", "200", "117000.00"), hex.EncodeToString(first[:]))
}

func TestCheckSignature(t *testing.T) {
	const key, orderID, code, amount = "SB-Mid-server-x", "GS-1-ABC", "200", "117000.00"
	tests := []struct {
		name                       string
		key, orderID, code, amount string
		signature                  string
		want                       bool
	}{
		{name: "right", key: key, orderID: orderID, code: code, amount: amount, signature: knownSignature, want: true},
		{name: "upper-case hex", key: key, orderID: orderID, code: code, amount: amount, signature: strings.ToUpper(knownSignature), want: true},
		{name: "mixed case hex", key: key, orderID: orderID, code: code, amount: amount, signature: strings.ToUpper(knownSignature[:64]) + knownSignature[64:], want: true},
		{name: "another order_id", key: key, orderID: "GS-1-ABD", code: code, amount: amount, signature: knownSignature},
		{name: "another status_code", key: key, orderID: orderID, code: "201", amount: amount, signature: knownSignature},
		{name: "another gross_amount", key: key, orderID: orderID, code: code, amount: "117000", signature: knownSignature},
		{name: "another server key", key: "SB-Mid-server-y", orderID: orderID, code: code, amount: amount, signature: knownSignature},
		{name: "empty signature", key: key, orderID: orderID, code: code, amount: amount, signature: ""},
		{name: "truncated", key: key, orderID: orderID, code: code, amount: amount, signature: knownSignature[:127]},
		{name: "one byte longer", key: key, orderID: orderID, code: code, amount: amount, signature: knownSignature + "0"},
		{name: "prefix only", key: key, orderID: orderID, code: code, amount: amount, signature: knownSignature[:64]},
		{name: "last hex digit changed", key: key, orderID: orderID, code: code, amount: amount, signature: knownSignature[:127] + "f"},
		{name: "first hex digit changed", key: key, orderID: orderID, code: code, amount: amount, signature: "8" + knownSignature[1:]},
		{name: "SHA-512 of nothing", key: key, orderID: orderID, code: code, amount: amount, signature: Signature("", "", "", "")},
		{name: "fields shifted between order_id and status_code", key: key, orderID: "GS-1-ABC2", code: "00", amount: amount, signature: knownSignature, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testx.AssertEqual(t, CheckSignature(tt.key, tt.orderID, tt.code, tt.amount, tt.signature), tt.want)
		})
	}
}

func TestClient_VerifySignature_UsesItsServerKey(t *testing.T) {
	c := New(testServerKey, testClientKey, 0)
	other := New("SB-Mid-server-another", testClientKey, 0)
	sig := Signature(testServerKey, "GS-9", "200", "50000.00")

	testx.AssertTrue(t, c.VerifySignature("GS-9", "200", "50000.00", sig))
	testx.AssertTrue(t, c.VerifySignature("GS-9", "200", "50000.00", strings.ToUpper(sig)))
	testx.AssertFalse(t, c.VerifySignature("GS-9", "200", "50000.01", sig))
	testx.AssertFalse(t, c.VerifySignature("GS-9", "200", "50000.00", ""))
	testx.AssertFalse(t, other.VerifySignature("GS-9", "200", "50000.00", sig), "another merchant's key verifies")
	testx.AssertFalse(t, c.VerifySignature("GS-9", "200", "50000.00", Signature("SB-Mid-server-another", "GS-9", "200", "50000.00")))
}
