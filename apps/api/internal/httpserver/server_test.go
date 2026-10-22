package httpserver_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpserver"
)

func TestNew(t *testing.T) {
	tests := []struct {
		name             string
		requestTimeout   time.Duration
		wantWriteTimeout time.Duration
	}{
		{name: "default request timeout", requestTimeout: 15 * time.Second, wantWriteTimeout: 25 * time.Second},
		{name: "longest request timeout", requestTimeout: 60 * time.Second, wantWriteTimeout: 70 * time.Second},
		{name: "shortest request timeout", requestTimeout: time.Second, wantWriteTimeout: 11 * time.Second},
	}
	h := http.NotFoundHandler()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httpserver.New(":8080", h, tt.requestTimeout)

			testx.AssertEqual(t, srv.Addr, ":8080")
			testx.AssertTrue(t, srv.Handler != nil, "handler is set")
			testx.AssertEqual(t, srv.ReadHeaderTimeout, 5*time.Second)
			testx.AssertEqual(t, srv.ReadTimeout, 15*time.Second)
			testx.AssertEqual(t, srv.IdleTimeout, 120*time.Second)
			testx.AssertEqual(t, srv.MaxHeaderBytes, 1<<20)
			// The write timeout always leaves room to write the 503 after
			// the request's own deadline.
			testx.AssertEqual(t, srv.WriteTimeout, tt.wantWriteTimeout)
			testx.AssertTrue(t, srv.WriteTimeout > tt.requestTimeout, "write timeout outlives the request timeout")
		})
	}
}
