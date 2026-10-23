package httpapi

import "net/http"

// SecurityHeaders sets the response headers that keep a browser from
// misusing what the API returns (OWASP API8, security misconfiguration):
//
//   - X-Content-Type-Options: nosniff, so JSON is never sniffed into HTML
//     or script;
//   - Content-Security-Policy: default-src 'none'; frame-ancestors 'none',
//     so a response opened in a tab can load nothing and cannot be framed
//     (X-Frame-Options: DENY says the same to older browsers);
//   - Referrer-Policy: no-referrer;
//   - Cache-Control: no-store, so tokens and personal data are never kept
//     by a browser or a proxy cache. A later chapter that wants the public
//     catalog cached sets its own Cache-Control on those routes;
//   - Strict-Transport-Security when hsts is set (everywhere but
//     development, where the API is plain HTTP on localhost): browsers then
//     only ever reach the API over HTTPS.
//
// The headers are set before the handler runs, so error responses carry
// them too.
func SecurityHeaders(hsts bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Cache-Control", "no-store")
			if hsts {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}
