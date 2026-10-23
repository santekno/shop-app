package httpapi_test

import (
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// One IPv6 customer usually gets a whole /64, so the per-IP limits count
// the network, not the address; an IPv4 address is counted as it is.
func TestRateLimitKey(t *testing.T) {
	tests := []struct{ in, want string }{
		{in: "203.0.113.7", want: "203.0.113.7"},
		{in: "10.0.0.1", want: "10.0.0.1"},
		{in: "2001:db8:1:2::5", want: "2001:db8:1:2::/64"},
		{in: "2001:db8:1:2:ffff:ffff:ffff:ffff", want: "2001:db8:1:2::/64"},
		{in: "2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd", want: "2001:db8:1:2::/64"},
		{in: "2001:db8:1:3::5", want: "2001:db8:1:3::/64"},
		{in: "::1", want: "::/64"},
		{in: "unknown", want: "unknown"},
		{in: "", want: ""},
		{in: "203.0.113.7:4321", want: "203.0.113.7:4321"},
	}
	for _, tt := range tests {
		testx.AssertEqual(t, httpapi.RateLimitKey(tt.in), tt.want, "RateLimitKey(%q)", tt.in)
	}
}
