package order

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// A provider that refuses the parcel (no courier serves the address) is
// 422 SHIPPING_UNAVAILABLE: retrying does not help, another address might.
// A provider that cannot answer stays 503.
func TestToHTTPError_Shipping(t *testing.T) {
	tests := []struct {
		err    error
		status int
		code   string
	}{
		{err: fmt.Errorf("quote shipping: %w: biteship answered 422", shipping.ErrNotServed), status: http.StatusUnprocessableEntity, code: CodeShippingUnavailable},
		{err: fmt.Errorf("quote shipping: %w: biteship answered 500", shipping.ErrUnavailable), status: http.StatusServiceUnavailable, code: httpapi.CodeUpstreamUnavailable},
	}
	for _, tt := range tests {
		rec := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/checkout", nil)
		httpapi.Error(rec, req, toHTTPError(tt.err))
		b := assertError(t, rec, tt.status, tt.code)
		testx.AssertNotEqual(t, b.Error.Message, "", "a message for the buyer")
	}
}

// The service passes ErrNotServed on from the provider, for the preview,
// the quotes and checkout alike.
func TestService_ShippingNotServed(t *testing.T) {
	env := newServiceEnv(line(v1, 1, 1000, 5))
	env.provider.err = fmt.Errorf("%w: biteship answered 400", shipping.ErrNotServed)
	_, err := env.svc.Preview(context.Background(), buyerID, PreviewInput{AddressID: addressID, Courier: shipping.CourierJNE, Service: "REG"})
	testx.AssertTrue(t, errors.Is(err, shipping.ErrNotServed), "preview: %v", err)
	_, err = env.svc.ShippingQuotes(context.Background(), buyerID, addressID)
	testx.AssertTrue(t, errors.Is(err, shipping.ErrNotServed), "quotes: %v", err)
	env.repo.claim = claimResult{claimed: true, claimID: "c"}
	_, err = env.svc.Checkout(context.Background(), buyerID, Idempotency{Key: "k"}, checkoutIn())
	testx.AssertTrue(t, errors.Is(err, shipping.ErrNotServed), "checkout: %v", err)
	testx.AssertFalse(t, errors.Is(err, shipping.ErrUnavailable))
	testx.AssertEqual(t, len(env.repo.released), 1, "the key is released")
}
