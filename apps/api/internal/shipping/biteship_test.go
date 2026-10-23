package shipping

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

const testAPIKey = "biteship_test.key-0123" // #nosec G101 -- a test value, not a credential

// biteshipServer answers POST /v1/rates/couriers with handle, and records
// the last request and how many came.
type biteshipServer struct {
	*httptest.Server
	requests atomic.Int32
	method   string
	path     string
	header   http.Header
	body     map[string]any
}

func newBiteshipServer(t *testing.T, handle func(w http.ResponseWriter, r *http.Request)) *biteshipServer {
	t.Helper()
	s := &biteshipServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.requests.Add(1)
		s.method, s.path, s.header = r.Method, r.URL.Path, r.Header.Clone()
		b, _ := io.ReadAll(r.Body)
		s.body = nil
		_ = json.Unmarshal(b, &s.body)
		handle(w, r)
	}))
	t.Cleanup(s.Close)
	return s
}

func answer(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

const ratesAnswer = `{"success":true,"object":"courier_pricing","pricing":[
 {"courier_code":"jne","courier_name":"JNE","courier_service_code":"reg","courier_service_name":"Reguler","duration":"2 - 3 days","price":12000},
 {"courier_code":"JNT","courier_name":"J&T","courier_service_code":"ez","courier_service_name":"EZ","duration":"2 - 3 days","price":11000},
 {"courier_code":"sicepat","courier_name":"SiCepat","courier_service_code":"best","courier_service_name":"Besok Sampai","duration":"1 days","price":20000},
 {"courier_code":"anteraja","courier_name":"AnterAja","courier_service_code":"reg","courier_service_name":"Reguler","duration":"2 days","price":5000},
 {"courier_code":"jne","courier_name":"JNE","courier_service_code":"yes","courier_service_name":"YES","duration":"1 days","price":0},
 {"courier_code":"jne","courier_name":"JNE","courier_service_code":"oke","courier_service_name":"OKE","duration":"4 days","price":-1},
 {"courier_code":"jne","courier_name":"JNE","courier_service_code":"","courier_service_name":"?","duration":"","price":9000}
]}`

func parcel() Request {
	return Request{OriginPostalCode: "40115", DestinationPostalCode: "12940", WeightGrams: 1250, Value: 250000}
}

func TestBiteship_Quote(t *testing.T) {
	s := newBiteshipServer(t, answer(http.StatusOK, ratesAnswer))
	b := NewBiteship(testAPIKey, s.URL+"/", time.Second) // a trailing slash is trimmed
	testx.AssertEqual(t, b.Name(), "biteship")

	quotes, err := b.Quote(context.Background(), parcel())
	testx.AssertNoError(t, err)

	// The request.
	testx.AssertEqual(t, s.method, http.MethodPost)
	testx.AssertEqual(t, s.path, "/v1/rates/couriers")
	testx.AssertEqual(t, s.header.Get("Authorization"), testAPIKey, "the key as it is, without Bearer")
	testx.AssertEqual(t, s.header.Get("Content-Type"), "application/json")
	testx.AssertEqual(t, s.header.Get("Accept"), "application/json")
	got, _ := json.Marshal(s.body)
	testx.AssertEqual(t, string(got),
		`{"couriers":"jne,jnt,sicepat","destination_postal_code":12940,"items":[{"name":"GoShop order","quantity":1,"value":250000,"weight":1250}],"origin_postal_code":40115}`,
		"postal codes as numbers, the order as one item")

	// The answer: GoShop's couriers with a usable price, cheapest first.
	testx.AssertEqual(t, len(quotes), 3, "%+v", quotes)
	testx.AssertEqual(t, quotes[0], Quote{Courier: CourierJNT, CourierName: "J&T", Service: "EZ", ServiceName: "EZ", Price: 11000, ETD: "2 - 3 days"})
	testx.AssertEqual(t, quotes[1], Quote{Courier: CourierJNE, CourierName: "JNE", Service: "REG", ServiceName: "Reguler", Price: 12000, ETD: "2 - 3 days"})
	testx.AssertEqual(t, quotes[2].Courier, CourierSiCepat)
	testx.AssertEqual(t, quotes[2].Service, "BEST", "service codes are upper-cased")
	_, ok := Find(quotes, CourierJNE, "REG")
	testx.AssertTrue(t, ok, "checkout finds the service by its upper-case code")
}

func TestBiteship_ZeroWeightIsOneGram(t *testing.T) {
	s := newBiteshipServer(t, answer(http.StatusOK, `{"success":true,"pricing":[]}`))
	req := parcel()
	req.WeightGrams = 0
	quotes, err := NewBiteship(testAPIKey, s.URL, time.Second).Quote(context.Background(), req)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(quotes), 0)
	items := s.body["items"].([]any)
	testx.AssertEqual(t, items[0].(map[string]any)["weight"], any(float64(1)))
}

// Anything but a usable answer is ErrUnavailable (503 to the client), and
// a POST is never retried: the buyer presses the button again.
func TestBiteship_Unavailable(t *testing.T) {
	big := `{"success":true,"pricing":[],"padding":"` + strings.Repeat("a", maxBiteshipResponse) + `"}`
	tests := []struct {
		name   string
		handle func(http.ResponseWriter, *http.Request)
		want   string
	}{
		{name: "500", handle: answer(http.StatusInternalServerError, `{"success":false}`), want: "biteship answered 500"},
		{name: "503 is not retried", handle: answer(http.StatusServiceUnavailable, ``), want: "biteship answered 503"},
		{name: "401 (a bad key)", handle: answer(http.StatusUnauthorized, `{"success":false,"error":"Authentication"}`), want: "biteship answered 401"},
		{name: "success false", handle: answer(http.StatusOK, `{"success":false,"error":"no couriers"}`), want: "biteship answered success=false"},
		{name: "not JSON", handle: answer(http.StatusOK, `<html>`), want: "biteship: decode answer: "},
		{name: "over the size limit", handle: answer(http.StatusOK, big), want: "biteship: decode answer: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newBiteshipServer(t, tt.handle)
			quotes, err := NewBiteship(testAPIKey, s.URL, time.Second).Quote(context.Background(), parcel())
			testx.AssertTrue(t, errors.Is(err, ErrUnavailable), "err = %v", err)
			testx.AssertContains(t, err.Error(), tt.want)
			testx.AssertEqual(t, len(quotes), 0)
			testx.AssertEqual(t, s.requests.Load(), int32(1), "one request, no retry")
			testx.AssertFalse(t, strings.Contains(err.Error(), testAPIKey), "the key never reaches an error")
		})
	}
	t.Run("a slow answer times out", func(t *testing.T) {
		release := make(chan struct{})
		s := newBiteshipServer(t, func(_ http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-release:
			}
		})
		defer close(release)
		start := time.Now()
		_, err := NewBiteship(testAPIKey, s.URL, 50*time.Millisecond).Quote(context.Background(), parcel())
		testx.AssertTrue(t, errors.Is(err, ErrUnavailable), "err = %v", err)
		testx.AssertTrue(t, time.Since(start) < 2*time.Second, "gave up after %v", time.Since(start))
	})
	t.Run("nothing listens", func(t *testing.T) {
		s := httptest.NewServer(http.NotFoundHandler())
		url := s.URL
		s.Close()
		_, err := NewBiteship(testAPIKey, url, time.Second).Quote(context.Background(), parcel())
		testx.AssertTrue(t, errors.Is(err, ErrUnavailable), "err = %v", err)
	})
}

// A postal code that is not a number is refused before any request.
func TestBiteship_BadPostalCode(t *testing.T) {
	s := newBiteshipServer(t, answer(http.StatusOK, ratesAnswer))
	b := NewBiteship(testAPIKey, s.URL, time.Second)
	for _, req := range []Request{
		{OriginPostalCode: "", DestinationPostalCode: "12940"},
		{OriginPostalCode: "40115", DestinationPostalCode: "12-940"},
	} {
		_, err := b.Quote(context.Background(), req)
		testx.AssertError(t, err)
		testx.AssertContains(t, err.Error(), "postal code")
		testx.AssertFalse(t, errors.Is(err, ErrUnavailable), "our input, not the upstream")
	}
	testx.AssertEqual(t, s.requests.Load(), int32(0))
}

func TestBiteship_BadBaseURL(t *testing.T) {
	_, err := NewBiteship(testAPIKey, "http://bad host", time.Second).Quote(context.Background(), parcel())
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "biteship: build request: ")
}

// Biteship refusing the parcel (400/404/422: an unknown or unserved postal
// code) is ErrNotServed, which another address can fix; our key, its rate
// limit and its outages (401/403/429/5xx) are ErrUnavailable, which a retry
// later can fix.
func TestBiteship_StatusClasses(t *testing.T) {
	tests := []struct {
		status int
		want   error
		not    error
	}{
		{http.StatusBadRequest, ErrNotServed, ErrUnavailable},
		{http.StatusNotFound, ErrNotServed, ErrUnavailable},
		{http.StatusUnprocessableEntity, ErrNotServed, ErrUnavailable},
		{http.StatusUnauthorized, ErrUnavailable, ErrNotServed},
		{http.StatusForbidden, ErrUnavailable, ErrNotServed},
		{http.StatusTooManyRequests, ErrUnavailable, ErrNotServed},
		{http.StatusInternalServerError, ErrUnavailable, ErrNotServed},
		{http.StatusBadGateway, ErrUnavailable, ErrNotServed},
		{http.StatusServiceUnavailable, ErrUnavailable, ErrNotServed},
		{http.StatusCreated, ErrUnavailable, ErrNotServed}, // only 200 is an answer
	}
	for _, tt := range tests {
		t.Run(http.StatusText(tt.status), func(t *testing.T) {
			s := newBiteshipServer(t, answer(tt.status, `{"success":false,"error":"x"}`))
			_, err := NewBiteship(testAPIKey, s.URL, time.Second).Quote(context.Background(), parcel())
			testx.AssertTrue(t, errors.Is(err, tt.want), "status %d: %v", tt.status, err)
			testx.AssertFalse(t, errors.Is(err, tt.not), "status %d: %v", tt.status, err)
			testx.AssertContains(t, err.Error(), fmt.Sprintf("biteship answered %d", tt.status))
			testx.AssertEqual(t, s.requests.Load(), int32(1), "no retry")
		})
	}
}

// A buyer who hangs up does not cancel the call to Biteship: httpx's
// breaker counts a cancelled request as an upstream failure, and five in a
// row would open it for every buyer. APP_SHIPPING_TIMEOUT still bounds it.
func TestBiteship_CallOutlivesTheCaller(t *testing.T) {
	s := newBiteshipServer(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(20 * time.Millisecond) // long enough for the caller to be gone
		answer(http.StatusOK, ratesAnswer)(w, r)
	})
	b := NewBiteship(testAPIKey, s.URL, time.Second)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	quotes, err := b.Quote(ctx, parcel())
	testx.AssertNoError(t, err, "a cancelled caller context still completes the call")
	testx.AssertEqual(t, len(quotes), 3)
}

// B1: more cancelled requests than the breaker tolerates (five failures in
// a row open it), then a normal one: the breaker stays closed and the last
// buyer gets prices.
func TestBiteship_CancelledCallersDoNotOpenTheBreaker(t *testing.T) {
	s := newBiteshipServer(t, answer(http.StatusOK, ratesAnswer))
	b := NewBiteship(testAPIKey, s.URL, time.Second)
	for i := range 8 {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := b.Quote(ctx, parcel())
		testx.AssertNoError(t, err, "cancelled call %d", i+1)
	}
	quotes, err := b.Quote(context.Background(), parcel())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(quotes), 3)
	testx.AssertEqual(t, s.requests.Load(), int32(9), "every call reached Biteship")
}

// The timeout still ends a call that never answers, cancelled caller or
// not.
func TestBiteship_TimeoutStillApplies(t *testing.T) {
	release := make(chan struct{})
	s := newBiteshipServer(t, func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, err := NewBiteship(testAPIKey, s.URL, 50*time.Millisecond).Quote(ctx, parcel())
	testx.AssertTrue(t, errors.Is(err, ErrUnavailable), "err = %v", err)
	testx.AssertTrue(t, time.Since(start) < 2*time.Second, "gave up after %v", time.Since(start))
}
