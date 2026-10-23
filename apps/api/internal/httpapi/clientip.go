package httpapi

import (
	"net"
	"net/http"
	"strings"
)

// RateLimitKey is the key the per-IP limits count ip (from ClientIP) under:
// the address itself for IPv4, and its /64 network for IPv6, because one
// IPv6 customer usually gets a whole /64 and could otherwise change address
// on every attempt. An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is the
// IPv4 client a.b.c.d, so it is counted as plain a.b.c.d, never apart from
// it. Anything that is not an IP is returned as it is.
func RateLimitKey(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	if v4 := parsed.To4(); v4 != nil {
		return v4.String()
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// ClientIP is the address of the client that sent r, for rate limits and
// logs. With trustedHops = 0 it is the TCP peer (r.RemoteAddr): right when
// clients connect to the API directly, as with make up.
//
// Behind proxies (Railway's edge), the peer is the proxy and the client is
// in X-Forwarded-For, which each proxy appends to. Only the entries the
// trusted proxies added can be believed: anything to their left was sent
// by the client and may be invented to dodge a per-IP limit. So with
// trustedHops = n the client is the n-th entry from the right. When the
// header has fewer entries, or that entry is not an IP, the peer address is
// used instead.
func ClientIP(r *http.Request, trustedHops int) string {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = r.RemoteAddr
	}
	if trustedHops <= 0 {
		return peer
	}
	var hops []string
	for _, header := range r.Header.Values("X-Forwarded-For") {
		for h := range strings.SplitSeq(header, ",") {
			hops = append(hops, strings.TrimSpace(h))
		}
	}
	if len(hops) < trustedHops {
		return peer
	}
	ip := net.ParseIP(hops[len(hops)-trustedHops])
	if ip == nil {
		return peer
	}
	return ip.String()
}
