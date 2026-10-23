package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestClientIP(t *testing.T) {
	tests := []struct {
		name   string
		remote string
		xff    []string // one entry per X-Forwarded-For header line
		hops   int
		want   string
	}{
		{name: "no proxy: the peer", remote: "203.0.113.7:4321", hops: 0, want: "203.0.113.7"},
		// With no trusted proxy the header is the client's own invention.
		{name: "no proxy ignores the header", remote: "203.0.113.7:4321", xff: []string{"1.2.3.4"}, hops: 0, want: "203.0.113.7"},
		{name: "negative hops is none", remote: "203.0.113.7:4321", xff: []string{"1.2.3.4"}, hops: -1, want: "203.0.113.7"},
		{name: "one proxy: the last entry", remote: "10.0.0.2:80", xff: []string{"1.2.3.4, 198.51.100.9"}, hops: 1, want: "198.51.100.9"},
		// A client that prepends a fake address cannot move the one the
		// trusted proxy appended.
		{name: "spoofed entries on the left are ignored", remote: "10.0.0.2:80", xff: []string{"6.6.6.6, 7.7.7.7, 198.51.100.9"}, hops: 1, want: "198.51.100.9"},
		{name: "two proxies", remote: "10.0.0.2:80", xff: []string{"1.2.3.4, 198.51.100.9, 10.0.0.1"}, hops: 2, want: "198.51.100.9"},
		{name: "entries across header lines", remote: "10.0.0.2:80", xff: []string{"198.51.100.9", "10.0.0.1"}, hops: 2, want: "198.51.100.9"},
		{name: "fewer entries than hops: the peer", remote: "10.0.0.2:80", xff: []string{"198.51.100.9"}, hops: 2, want: "10.0.0.2"},
		{name: "no header with hops: the peer", remote: "10.0.0.2:80", hops: 1, want: "10.0.0.2"},
		{name: "not an IP: the peer", remote: "10.0.0.2:80", xff: []string{"unknown"}, hops: 1, want: "10.0.0.2"},
		{name: "IPv6, normalised", remote: "10.0.0.2:80", xff: []string{"2001:DB8:0:0::1"}, hops: 1, want: "2001:db8::1"},
		{name: "spaces trimmed", remote: "10.0.0.2:80", xff: []string{"  198.51.100.9  "}, hops: 1, want: "198.51.100.9"},
		{name: "IPv6 peer", remote: "[2001:db8::2]:443", hops: 0, want: "2001:db8::2"},
		{name: "peer without a port", remote: "203.0.113.7", hops: 0, want: "203.0.113.7"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			r.RemoteAddr = tt.remote
			for _, v := range tt.xff {
				r.Header.Add("X-Forwarded-For", v)
			}
			testx.AssertEqual(t, httpapi.ClientIP(r, tt.hops), tt.want)
		})
	}
}
